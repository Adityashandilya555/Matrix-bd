"""Design Department workflow router.

Access control:
  - Supervisor + Executive in module='design' use the queue / allocate / deliverable
    routes — require_role(SUPERVISOR, EXECUTIVE) + require_module('design').
  - The business_admin (tenant-wide, no module claim) uses the GFC routes —
    require_role(BUSINESS_ADMIN) only, NO module guard.

Opens once DDR is positive and Finance admin approval has pushed the site to
payments handoff. Progress is mirrored on sites.design_status.

Endpoints:
  GET    /design/queue                                 → design pipeline (finance-approved sites)
  GET    /design/gfc-queue                             → sites awaiting GFC (business admin)
  GET    /design/gfc/{site_id}                         → read package for GFC review (business admin)
  POST   /design/gfc/{site_id}                         → GFC decision approve/reject (business admin)
  GET    /design/{site_id}/delegations                 → active allocations for a site
  POST   /design/{site_id}/allocate                    → allocate site to a design executive (supervisor)
  DELETE /design/{site_id}/allocate/{user_id}          → revoke allocation (supervisor)
  POST   /design/{site_id}/deliverables/{kind}         → submit recce|2d|3d|boq (exec/supervisor)
  POST   /design/{site_id}/deliverables/{kind}/review  → approve/reject a deliverable (supervisor)
  GET    /design/{site_id}                             → full design review state
"""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status as http_status

from app.core.deps import DbDep, TenantId
from app.domain.schemas.common import OkResponse
from app.domain.schemas.design import (
    AdminReviewDeliverableRequest,
    AllocateDesignRequest,
    DesignAdminQueueResponse,
    DesignGfcQueueResponse,
    DesignHistoryResponse,
    DesignQueueResponse,
    DesignReviewResponse,
    GfcDecisionRequest,
    ReviewDeliverableRequest,
    SubmitDeliverableRequest,
)
from app.rbac.guards import require_module, require_role
from app.rbac.roles import Role
from app.services.delegation_service import svc_assigned_sites, svc_is_delegated
from app.services.design_service import (
    svc_admin_review_deliverable,
    svc_allocate_design,
    svc_design_admin_queue,
    svc_design_gfc_queue,
    svc_design_history,
    svc_design_queue,
    svc_get_design_review,
    svc_gfc_decision,
    svc_list_design_delegations_for_site,
    svc_review_deliverable,
    svc_revoke_design_delegation,
    svc_submit_deliverable,
)
from app.services.storage_service import upload_bytes as storage_upload

router = APIRouter(prefix="/design", tags=["Design"])

# Supervisor + executive in the design module reach the workflow routes.
# Allocation + deliverable review are supervisor-only. GFC is business_admin-only
# (no module guard — admins are tenant-wide and carry no module claim).
DesignMember = Annotated[dict, Depends(require_role(Role.SUPERVISOR, Role.EXECUTIVE))]
DesignSupervisor = Annotated[dict, Depends(require_role(Role.SUPERVISOR))]
InDesignModule = Annotated[dict, Depends(require_module("design"))]
BusinessAdmin = Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))]


def _is_executive(user: dict) -> bool:
    return (user.get("role") or "").lower() == Role.EXECUTIVE.value


# ── Queue ─────────────────────────────────────────────────────────────────────

@router.get(
    "/queue",
    response_model=DesignQueueResponse,
    summary="List finance-approved sites in the design pipeline",
)
async def design_queue(
    db: DbDep,
    current_user: DesignMember,
    _module: InDesignModule,
    tenant_id: TenantId,
) -> DesignQueueResponse:
    # Executives only see sites allocated to them. Supervisors see all.
    restrict_to: Optional[list[str]] = None
    if _is_executive(current_user):
        restrict_to = await svc_assigned_sites(
            db, tenant_id=tenant_id, user_id=current_user["sub"], module="design",
        )
    return await svc_design_queue(db, tenant_id=tenant_id, restrict_to_site_ids=restrict_to)


@router.get(
    "/history",
    response_model=DesignHistoryResponse,
    summary="List Design module history for this tenant",
)
async def design_history(
    db: DbDep,
    current_user: DesignMember,
    _module: InDesignModule,
    tenant_id: TenantId,
    status_filter: str = "all",
) -> DesignHistoryResponse:
    # Executives only see design history for sites delegated to them. Supervisors see all.
    restrict_to: Optional[list[str]] = None
    if _is_executive(current_user):
        restrict_to = await svc_assigned_sites(
            db, tenant_id=tenant_id, user_id=current_user["sub"], module="design",
        )
    return await svc_design_history(
        db, tenant_id=tenant_id, status_filter=status_filter, restrict_to_site_ids=restrict_to,
    )


# ── Business-admin GFC gate (require_role only — NO module guard) ─────────────

@router.get(
    "/gfc-queue",
    response_model=DesignGfcQueueResponse,
    summary="Sites awaiting Good-For-Construction approval (business admin)",
)
async def design_gfc_queue(
    db: DbDep,
    current_user: BusinessAdmin,
    tenant_id: TenantId,
) -> DesignGfcQueueResponse:
    return await svc_design_gfc_queue(db, tenant_id=tenant_id)


@router.get(
    "/gfc/{site_id}",
    response_model=DesignReviewResponse,
    summary="Read a site's full design package for GFC review (business admin)",
)
async def design_gfc_read(
    site_id: str,
    db: DbDep,
    current_user: BusinessAdmin,
    tenant_id: TenantId,
) -> DesignReviewResponse:
    return await svc_get_design_review(db, site_id=site_id, tenant_id=tenant_id)


@router.post(
    "/gfc/{site_id}",
    response_model=DesignReviewResponse,
    summary="Business admin Good-For-Construction decision (approve/reject + comments)",
)
async def design_gfc_decision(
    site_id: str,
    body: GfcDecisionRequest,
    db: DbDep,
    current_user: BusinessAdmin,
    tenant_id: TenantId,
) -> DesignReviewResponse:
    return await svc_gfc_decision(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body,
    )


# ── Business-admin 2D/3D approval (second tier; require_role only) ────────────

@router.get(
    "/admin-queue",
    response_model=DesignAdminQueueResponse,
    summary="2D/3D deliverables awaiting business-admin approval, grouped by site",
)
async def design_admin_queue(
    db: DbDep,
    current_user: BusinessAdmin,
    tenant_id: TenantId,
) -> DesignAdminQueueResponse:
    return await svc_design_admin_queue(db, tenant_id=tenant_id)


@router.post(
    "/{site_id}/deliverables/{kind}/admin-review",
    response_model=DesignReviewResponse,
    summary="Business admin: approve / send back a supervisor-approved 2D or 3D deliverable",
)
async def admin_review_deliverable(
    site_id: str,
    kind: str,
    body: AdminReviewDeliverableRequest,
    db: DbDep,
    current_user: BusinessAdmin,
    tenant_id: TenantId,
) -> DesignReviewResponse:
    return await svc_admin_review_deliverable(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, kind=kind, body=body,
    )


# ── Allocation (supervisor) — multi-segment paths before bare /{site_id} ─────

@router.get(
    "/{site_id}/delegations",
    summary="List active design allocations for a site (supervisor view)",
)
async def list_design_delegations(
    site_id: str,
    db: DbDep,
    current_user: DesignMember,
    _module: InDesignModule,
    tenant_id: TenantId,
) -> dict:
    return await svc_list_design_delegations_for_site(db, tenant_id=tenant_id, site_id=site_id)


@router.post(
    "/{site_id}/allocate",
    response_model=DesignReviewResponse,
    summary="Allocate a finance-approved site to a design executive",
)
async def allocate_design(
    site_id: str,
    body: AllocateDesignRequest,
    db: DbDep,
    current_user: DesignSupervisor,
    _module: InDesignModule,
    tenant_id: TenantId,
) -> DesignReviewResponse:
    return await svc_allocate_design(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
        delegate_user_id=body.executive_id, notes=body.notes,
    )


@router.delete(
    "/{site_id}/allocate/{user_id}",
    response_model=OkResponse,
    summary="Revoke a design allocation for a (site, user)",
)
async def revoke_design_allocation(
    site_id: str,
    user_id: str,
    db: DbDep,
    current_user: DesignSupervisor,
    _module: InDesignModule,
    tenant_id: TenantId,
) -> OkResponse:
    return await svc_revoke_design_delegation(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, delegate_user_id=user_id,
    )


# ── Deliverables ──────────────────────────────────────────────────────────────

@router.post(
    "/{site_id}/deliverables/{kind}",
    response_model=DesignReviewResponse,
    summary="Executive: submit a deliverable (recce | 2d | 3d | boq)",
)
async def submit_deliverable(
    site_id: str,
    kind: str,
    body: SubmitDeliverableRequest,
    db: DbDep,
    current_user: DesignMember,
    _module: InDesignModule,
    tenant_id: TenantId,
) -> DesignReviewResponse:
    return await svc_submit_deliverable(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, kind=kind, body=body,
    )


@router.post(
    "/{site_id}/deliverables/{kind}/review",
    response_model=DesignReviewResponse,
    summary="Supervisor: approve/reject a deliverable (comments required on reject)",
)
async def review_deliverable(
    site_id: str,
    kind: str,
    body: ReviewDeliverableRequest,
    db: DbDep,
    current_user: DesignSupervisor,
    _module: InDesignModule,
    tenant_id: TenantId,
) -> DesignReviewResponse:
    return await svc_review_deliverable(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, kind=kind, body=body,
    )


@router.post(
    "/{site_id}/deliverables/{kind}/upload",
    response_model=DesignReviewResponse,
    summary="Upload a deliverable document (recce/2d/3d) to storage and submit it",
)
async def upload_deliverable(
    site_id: str,
    kind: str,
    db: DbDep,
    current_user: DesignMember,
    _module: InDesignModule,
    tenant_id: TenantId,
    file: UploadFile = File(...),
) -> DesignReviewResponse:
    body_bytes = await file.read()
    safe_name = (file.filename or "document").replace("/", "_").replace("\\", "_")
    path = f"design/{site_id}/{kind}/{safe_name}"
    await storage_upload(
        path=path, body=body_bytes,
        content_type=file.content_type or "application/octet-stream",
    )
    req = SubmitDeliverableRequest(file_url=path, file_name=safe_name)
    return await svc_submit_deliverable(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, kind=kind, body=req,
    )


# ── Full review (members) — declared LAST so /{site_id} doesn't shadow above ──

@router.get(
    "/{site_id}",
    response_model=DesignReviewResponse,
    summary="Get full design review state for a site",
)
async def get_design_review(
    site_id: str,
    db: DbDep,
    current_user: DesignMember,
    _module: InDesignModule,
    tenant_id: TenantId,
) -> DesignReviewResponse:
    # Executives can only read a site allocated to them. Supervisors are unrestricted.
    if _is_executive(current_user):
        ok = await svc_is_delegated(
            db, tenant_id=tenant_id, site_id=site_id,
            user_id=current_user["sub"], module="design",
        )
        if not ok:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND, detail="Site not found",
            )
    return await svc_get_design_review(db, site_id=site_id, tenant_id=tenant_id)
