"""Launch Approval router — the post-NSO validation loop.

Flow:  pending_admin_review → under_exec_review → under_supervisor_review
       → pending_admin_final → ready_to_launch → launched

Role gating:
  Queue / detail GET            → business_admin + supervisor + executive
  Send for review / final confirm / launch
                                → business_admin only
  Rent-field save               → business_admin + supervisor
                                  (service enforces who may edit at which status)
  Executive review (verdict)    → executive only (service enforces site-creator)
  Supervisor review (verdict)   → supervisor only
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.deps import DbDep, TenantId
from app.domain.schemas.launch import (
    LaunchApprovalResponse,
    LaunchCommentRequest,
    LaunchQueueResponse,
    LaunchRentFieldsRequest,
    LaunchReviewRequest,
)
from app.rbac.guards import require_role
from app.rbac.roles import Role
from app.services.launch_service import (
    svc_admin_final_confirm,
    svc_admin_send_for_review,
    svc_exec_review,
    svc_get_approval,
    svc_get_launch_queue,
    svc_launch,
    svc_save_rent_fields,
    svc_supervisor_review,
)

router = APIRouter(prefix="/launch-approvals", tags=["Launch Approvals"])

AdminUser = Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))]
EditorUser = Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN, Role.SUPERVISOR))]
# The first review stage is the SITE CREATOR — who may be an executive OR a
# supervisor (supervisors can create pipelines via delegation). Role is checked
# here; svc_exec_review additionally enforces that the actor is the creator.
CreatorUser = Annotated[dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR))]
SupervisorUser = Annotated[dict, Depends(require_role(Role.SUPERVISOR))]
AnyUser = Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN, Role.SUPERVISOR, Role.EXECUTIVE))]


# ── Queue / detail ───────────────────────────────────────────────────────────────

@router.get("/queue", response_model=LaunchQueueResponse)
async def get_launch_queue(
    db: DbDep,
    _auth: AnyUser,
    tenant_id: TenantId,
    status: str = Query(default=None, description="Comma-separated status filter"),
    limit: int = Query(500, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> LaunchQueueResponse:
    return await svc_get_launch_queue(
        db, tenant_id=tenant_id, status_filter=status, limit=limit, offset=offset,
    )


@router.get("/{site_id}", response_model=LaunchApprovalResponse)
async def get_launch_approval(
    site_id: str,
    db: DbDep,
    _auth: AnyUser,
    tenant_id: TenantId,
) -> LaunchApprovalResponse:
    return await svc_get_approval(db, tenant_id=tenant_id, site_id=site_id)


# ── Rent edits (admin first/final touch, supervisor on review) ───────────────────

@router.patch("/{site_id}/rent-fields", response_model=LaunchApprovalResponse)
async def save_rent_fields(
    site_id: str,
    body: LaunchRentFieldsRequest,
    db: DbDep,
    current_user: EditorUser,
    tenant_id: TenantId,
) -> LaunchApprovalResponse:
    """Partial update of the rent-only staging fields. The service rejects edits
    by a role/status combination that isn't allowed."""
    return await svc_save_rent_fields(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body)


# ── Stage transitions ────────────────────────────────────────────────────────────

@router.post("/{site_id}/send-for-review", response_model=LaunchApprovalResponse)
async def send_for_review(
    site_id: str,
    body: LaunchCommentRequest,
    db: DbDep,
    current_user: AdminUser,
    tenant_id: TenantId,
) -> LaunchApprovalResponse:
    """Admin 1st touch → routes to the creating executive."""
    return await svc_admin_send_for_review(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body)


@router.post("/{site_id}/exec-review", response_model=LaunchApprovalResponse)
async def exec_review(
    site_id: str,
    body: LaunchReviewRequest,
    db: DbDep,
    current_user: CreatorUser,
    tenant_id: TenantId,
) -> LaunchApprovalResponse:
    """The site CREATOR (executive or supervisor) records Approve / Reject
    (+ comment). The service enforces creator-only. Flows forward."""
    return await svc_exec_review(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body)


@router.post("/{site_id}/supervisor-review", response_model=LaunchApprovalResponse)
async def supervisor_review(
    site_id: str,
    body: LaunchReviewRequest,
    db: DbDep,
    current_user: SupervisorUser,
    tenant_id: TenantId,
) -> LaunchApprovalResponse:
    """Supervisor records Approve / Reject (+ comment). Flows forward to admin."""
    return await svc_supervisor_review(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body)


@router.post("/{site_id}/final-confirm", response_model=LaunchApprovalResponse)
async def final_confirm(
    site_id: str,
    body: LaunchCommentRequest,
    db: DbDep,
    current_user: AdminUser,
    tenant_id: TenantId,
) -> LaunchApprovalResponse:
    """Admin final touch → commits the agreed rent terms to the DB, unlocks Launch."""
    return await svc_admin_final_confirm(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body)


@router.post("/{site_id}/launch", response_model=LaunchApprovalResponse)
async def launch_site(
    site_id: str,
    db: DbDep,
    current_user: AdminUser,
    tenant_id: TenantId,
) -> LaunchApprovalResponse:
    """Final go-live. Sets site.is_launched = True and status = 'launched'."""
    return await svc_launch(db, tenant_id=tenant_id, actor=current_user, site_id=site_id)
