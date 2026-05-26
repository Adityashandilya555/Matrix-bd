"""Legal Department workflow router.

Access control: caller must be role=supervisor OR role=executive AND module=legal.
The two Annotated deps are composed per-route so finalize/agreement/licensing
are supervisor-only while viewing and saving DD items allows executives too.

Endpoints:
  GET  /legal/queue                      → legal queue (LEGAL_REVIEW sites)
  GET  /legal/{site_id}                  → full legal review for a site
  POST /legal/{site_id}/dd/items         → Step 1 · save DD checklist items
  POST /legal/{site_id}/dd/finalize      → Step 2 · stamp final_verdict (supervisor only)
  POST /legal/{site_id}/agreement        → Step 3 · save agreement (supervisor only)
  POST /legal/{site_id}/licensing        → Step 4 · save licensing → LEGAL_APPROVED
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.deps import DbDep, TenantId
from app.domain.schemas.common import OkResponse
from app.domain.schemas.legal import (
    LegalQueueResponse,
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
from app.services.legal_service import (
    svc_get_legal_review,
    svc_legal_queue,
    svc_save_agreement,
    svc_save_due_diligence,
    svc_save_licensing,
    svc_save_verification,
)

router = APIRouter(prefix="/legal", tags=["Legal"])

# Both supervisor and executive in the legal module can access legal routes.
# Finalize / agreement / licensing are further restricted to supervisor below.
LegalMember  = Annotated[dict, Depends(require_role(Role.SUPERVISOR, Role.EXECUTIVE))]
LegalSupervisor = Annotated[dict, Depends(require_role(Role.SUPERVISOR))]
InLegalModule = Annotated[dict, Depends(require_module("legal"))]


# ── Queue ─────────────────────────────────────────────────────────────────────

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
    return await svc_legal_queue(db, tenant_id=tenant_id)


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


# ── Step 4 · Licensing (supervisor only) ─────────────────────────────────────

@router.post(
    "/{site_id}/licensing",
    response_model=LegalReviewResponse,
    summary="Step 4 · Save licensing checklist → auto-approves site to LEGAL_APPROVED",
)
async def save_licensing(
    site_id: str,
    body: SaveLicensingRequest,
    db: DbDep,
    current_user: LegalSupervisor,
    _module: InLegalModule,
    tenant_id: TenantId,
) -> LegalReviewResponse:
    return await svc_save_licensing(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body,
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
