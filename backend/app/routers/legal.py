"""Legal Department workflow router.

Access control: caller must be role=supervisor OR role=executive AND module=legal.
The two Annotated deps are composed per-route so finalize/agreement are
supervisor-only while checklist item saves allow delegated executives too.

Endpoints:
  GET  /legal/queue                      → legal queue (LEGAL_REVIEW sites)
  GET  /legal/{site_id}                  → full legal review for a site
  POST /legal/{site_id}/dd/items         → Step 1 · save DD checklist items
  POST /legal/{site_id}/dd/finalize      → Step 2 · stamp final_verdict (supervisor only)
  POST /legal/{site_id}/agreement        → Step 3 · save agreement (supervisor only)
  POST /legal/{site_id}/licensing        → Step 4 · save licensing → LEGAL_APPROVED
"""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status as http_status
from pydantic import BaseModel

from app.core.deps import DbDep, TenantId
from app.domain.schemas.common import OkResponse
from app.domain.schemas.legal import (
    LegalHistoryResponse,
    LegalQueueResponse,
    LegalRejectedSitesResponse,
    LegalReviewResponse,
    SaveAgreementRequest,
    SaveDueDiligenceRequest,
    SaveLicensingRequest,
    SaveVerificationRequest,
)
from app.domain.schemas.legal_change_request import (
    ChangeRequestListResponse,
    ChangeRequestResponse,
    ReviewChangeRequestRequest,
)
from app.rbac.guards import require_module, require_role
from app.rbac.roles import Role
from app.services.change_request_service import (
    svc_approve_change_request,
    svc_list_pending_for_legal,
    svc_reject_change_request,
)
from app.services.delegation_service import (
    svc_assigned_sites,
    svc_delegate_legal,
    svc_is_delegated,
    svc_list_legal_delegations_for_site,
    svc_list_my_legal_assignments,
    svc_revoke_legal_delegation,
)
from app.services.legal_service import (
    svc_get_legal_review,
    svc_legal_history,
    svc_legal_queue,
    svc_legal_rejected_sites,
    svc_save_agreement,
    svc_save_due_diligence,
    svc_save_licensing,
    svc_save_verification,
    svc_submit_dd_for_review,
    svc_submit_licensing_for_review,
)

router = APIRouter(prefix="/legal", tags=["Legal"])

# Both supervisor and executive in the legal module can access legal routes.
# Finalize + agreement are supervisor-only. Licensing saves are allowed for
# delegated legal executives, with the service enforcing draft-stage limits.
LegalMember  = Annotated[dict, Depends(require_role(Role.SUPERVISOR, Role.EXECUTIVE))]
LegalSupervisor = Annotated[dict, Depends(require_role(Role.SUPERVISOR))]
InLegalModule = Annotated[dict, Depends(require_module("legal"))]


# ── Queue ─────────────────────────────────────────────────────────────────────

def _is_executive(user: dict) -> bool:
    return (user.get("role") or "").lower() == Role.EXECUTIVE.value


@router.get(
    "/queue",
    response_model=LegalQueueResponse,
    summary="List sites awaiting legal review",
)
async def legal_queue(
    db: DbDep,
    current_user: LegalMember,
    _module: InLegalModule,
    tenant_id: TenantId,
) -> LegalQueueResponse:
    # Executives only see sites delegated to them. Supervisors see all.
    restrict_to: Optional[list[str]] = None
    if _is_executive(current_user):
        restrict_to = await svc_assigned_sites(
            db, tenant_id=tenant_id, user_id=current_user["sub"], module="legal",
        )
    return await svc_legal_queue(db, tenant_id=tenant_id, restrict_to_site_ids=restrict_to)


@router.get(
    "/rejected-sites",
    response_model=LegalRejectedSitesResponse,
    summary="List sites rejected by Legal during due diligence",
)
async def legal_rejected_sites(
    db: DbDep,
    current_user: LegalMember,
    _module: InLegalModule,
    tenant_id: TenantId,
) -> LegalRejectedSitesResponse:
    return await svc_legal_rejected_sites(db, tenant_id=tenant_id)


@router.get(
    "/history",
    response_model=LegalHistoryResponse,
    summary="List all legal-processed sites (approved + rejected)",
)
async def legal_history(
    db: DbDep,
    current_user: LegalMember,
    _module: InLegalModule,
    tenant_id: TenantId,
) -> LegalHistoryResponse:
    return await svc_legal_history(db, tenant_id=tenant_id)


# ── Delegations ───────────────────────────────────────────────────────────────
# Routes are defined BEFORE `GET /{site_id}` so the static `/delegations/...`
# path doesn't collide with the dynamic `{site_id}` segment in the router's
# match order. FastAPI matches in declaration order — keep static-first.


class DelegateLegalRequest(BaseModel):
    executive_id: str
    notes: Optional[str] = None


@router.get(
    "/delegations/me",
    summary="List sites delegated to the current executive (legal module)",
)
async def list_my_legal_assignments(
    db: DbDep,
    current_user: LegalMember,
    _module: InLegalModule,
    tenant_id: TenantId,
) -> dict:
    return await svc_list_my_legal_assignments(db, tenant_id=tenant_id, actor=current_user)


@router.get(
    "/{site_id}/delegations",
    summary="List active legal delegations for a site (supervisor view)",
)
async def list_legal_delegations_for_site(
    site_id: str,
    db: DbDep,
    current_user: LegalMember,
    _module: InLegalModule,
    tenant_id: TenantId,
) -> dict:
    return await svc_list_legal_delegations_for_site(db, tenant_id=tenant_id, site_id=site_id)


@router.post(
    "/{site_id}/delegate",
    summary="Delegate legal responsibility for a site to an executive",
)
async def delegate_legal(
    site_id: str,
    body: DelegateLegalRequest,
    db: DbDep,
    current_user: LegalSupervisor,
    _module: InLegalModule,
    tenant_id: TenantId,
) -> dict:
    return await svc_delegate_legal(
        db,
        tenant_id=tenant_id,
        actor=current_user,
        site_id=site_id,
        delegate_user_id=body.executive_id,
        notes=body.notes,
    )


@router.delete(
    "/{site_id}/delegate/{user_id}",
    response_model=OkResponse,
    summary="Revoke a legal delegation for a (site, user)",
)
async def revoke_legal_delegation(
    site_id: str,
    user_id: str,
    db: DbDep,
    current_user: LegalSupervisor,
    _module: InLegalModule,
    tenant_id: TenantId,
) -> OkResponse:
    return await svc_revoke_legal_delegation(
        db,
        tenant_id=tenant_id,
        actor=current_user,
        site_id=site_id,
        delegate_user_id=user_id,
    )


@router.get(
    "/{site_id}",
    response_model=LegalReviewResponse,
    summary="Get full legal review state for a site",
)
async def get_legal_review(
    site_id: str,
    db: DbDep,
    current_user: LegalMember,
    _module: InLegalModule,
    tenant_id: TenantId,
) -> LegalReviewResponse:
    # Executives can only read a site if it's delegated to them. Supervisors
    # are unrestricted (additive filter — does not break the supervisor path).
    if _is_executive(current_user):
        ok = await svc_is_delegated(
            db,
            tenant_id=tenant_id,
            site_id=site_id,
            user_id=current_user["sub"],
            module="legal",
        )
        if not ok:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="Site not found",
            )
    return await svc_get_legal_review(db, site_id=site_id, tenant_id=tenant_id)


# ── Step 1 · DD checklist items (supervisor OR executive) ─────────────────────

@router.post(
    "/{site_id}/dd/items",
    response_model=LegalReviewResponse,
    summary="Step 1 · Save due-diligence checklist items",
)
async def save_dd_items(
    site_id: str,
    body: SaveVerificationRequest,
    db: DbDep,
    current_user: LegalMember,
    _module: InLegalModule,
    tenant_id: TenantId,
) -> LegalReviewResponse:
    return await svc_save_verification(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body,
    )


# ── Submit DD draft for review (executive — delegated — or supervisor) ──────

@router.post(
    "/{site_id}/dd/submit-for-review",
    response_model=LegalReviewResponse,
    summary="Executive: submit DD draft for supervisor review (stage draft → pending_review)",
)
async def submit_dd_for_review(
    site_id: str,
    db: DbDep,
    current_user: LegalMember,
    _module: InLegalModule,
    tenant_id: TenantId,
) -> LegalReviewResponse:
    return await svc_submit_dd_for_review(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
    )


# ── Step 2 · Finalize DD verdict (supervisor only) ────────────────────────────

@router.post(
    "/{site_id}/dd/finalize",
    response_model=LegalReviewResponse,
    summary="Step 2 · Stamp final DD verdict (positive → continue; negative → reject)",
)
async def finalize_dd(
    site_id: str,
    body: SaveDueDiligenceRequest,
    db: DbDep,
    current_user: LegalSupervisor,
    _module: InLegalModule,
    tenant_id: TenantId,
) -> LegalReviewResponse:
    return await svc_save_due_diligence(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body,
    )


# ── Step 3 · Agreement (supervisor only) ─────────────────────────────────────

@router.post(
    "/{site_id}/agreement",
    response_model=LegalReviewResponse,
    summary="Step 3 · Save agreement signed/registered",
)
async def save_agreement(
    site_id: str,
    body: SaveAgreementRequest,
    db: DbDep,
    current_user: LegalSupervisor,
    _module: InLegalModule,
    tenant_id: TenantId,
) -> LegalReviewResponse:
    return await svc_save_agreement(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body,
    )


# ── Step 4 · Licensing ───────────────────────────────────────────────────────

@router.post(
    "/{site_id}/licensing",
    response_model=LegalReviewResponse,
    summary="Step 4 · Save licensing checklist → supervisor all-yes auto-approves site",
)
async def save_licensing(
    site_id: str,
    body: SaveLicensingRequest,
    db: DbDep,
    current_user: LegalMember,
    _module: InLegalModule,
    tenant_id: TenantId,
) -> LegalReviewResponse:
    return await svc_save_licensing(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body,
    )


# ── Submit licensing draft for review (executive — delegated — or supervisor) ─

@router.post(
    "/{site_id}/licensing/submit-for-review",
    response_model=LegalReviewResponse,
    summary="Executive: submit licensing draft for supervisor review (stage draft → pending_review)",
)
async def submit_licensing_for_review(
    site_id: str,
    db: DbDep,
    current_user: LegalMember,
    _module: InLegalModule,
    tenant_id: TenantId,
) -> LegalReviewResponse:
    return await svc_submit_licensing_for_review(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
    )


# ── Change requests opened by BD ─────────────────────────────────────────────

@router.get(
    "/change-requests/pending",
    response_model=ChangeRequestListResponse,
    summary="List BD-opened change requests awaiting legal review",
)
async def list_pending_change_requests(
    db: DbDep,
    current_user: LegalMember,
    _module: InLegalModule,
    tenant_id: TenantId,
) -> ChangeRequestListResponse:
    return await svc_list_pending_for_legal(db, tenant_id=tenant_id)


@router.post(
    "/change-requests/{request_id}/approve",
    response_model=ChangeRequestResponse,
    summary="Approve a BD change request — overwrites the underlying field",
)
async def approve_change_request(
    request_id: str,
    body: ReviewChangeRequestRequest,
    db: DbDep,
    current_user: LegalSupervisor,
    _module: InLegalModule,
    tenant_id: TenantId,
) -> ChangeRequestResponse:
    return await svc_approve_change_request(
        db, tenant_id=tenant_id, actor=current_user, request_id=request_id, body=body,
    )


@router.post(
    "/change-requests/{request_id}/reject",
    response_model=ChangeRequestResponse,
    summary="Reject a BD change request — no change applied",
)
async def reject_change_request(
    request_id: str,
    body: ReviewChangeRequestRequest,
    db: DbDep,
    current_user: LegalSupervisor,
    _module: InLegalModule,
    tenant_id: TenantId,
) -> ChangeRequestResponse:
    return await svc_reject_change_request(
        db, tenant_id=tenant_id, actor=current_user, request_id=request_id, body=body,
    )
