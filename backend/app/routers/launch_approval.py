"""Launch Approval router.

Endpoints for the post-NSO multi-step sign-off chain.

Role gating:
  Admin queue / save fields / admin-approve / super-admin-approve / launch
    → business_admin only
  BD confirm
    → executive + supervisor (any BD member can confirm)
  Supervisor approve
    → supervisor only
  Queue GET endpoints
    → business_admin + supervisor (read-only for supervisor in admin portal)
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.deps import DbDep, TenantId
from app.domain.schemas.launch import (
    LaunchApprovalResponse,
    LaunchFieldsRequest,
    LaunchQueueResponse,
)
from app.rbac.guards import require_role
from app.rbac.roles import Role
from app.services.launch_service import (
    svc_admin_approve,
    svc_bd_confirm,
    svc_get_approval,
    svc_get_launch_queue,
    svc_launch,
    svc_save_fields,
    svc_supervisor_approve,
    svc_super_admin_approve,
)

router = APIRouter(prefix="/launch-approvals", tags=["Launch Approvals"])

AdminUser = Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))]
BdUser = Annotated[dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR))]
SupervisorUser = Annotated[dict, Depends(require_role(Role.SUPERVISOR))]
AnyUser = Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN, Role.SUPERVISOR, Role.EXECUTIVE))]


# ── Queue endpoints ────────────────────────────────────────────────────────────

@router.get("/queue", response_model=LaunchQueueResponse)
async def get_launch_queue(
    db: DbDep,
    current_user: AnyUser,
    tenant_id: TenantId,
    status: str = Query(default=None, description="Comma-separated status filter"),
) -> LaunchQueueResponse:
    """Returns all launch approval rows. business_admin sees all; supervisor + exec
    see their relevant statuses (filtered client-side or pass status param)."""
    return await svc_get_launch_queue(db, tenant_id=tenant_id, status_filter=status)


@router.get("/{site_id}", response_model=LaunchApprovalResponse)
async def get_launch_approval(
    site_id: str,
    db: DbDep,
    current_user: AnyUser,
    tenant_id: TenantId,
) -> LaunchApprovalResponse:
    """Full approval record for a site."""
    return await svc_get_approval(db, tenant_id=tenant_id, site_id=site_id)


# ── Mutation endpoints ─────────────────────────────────────────────────────────

@router.patch("/{site_id}/fields", response_model=LaunchApprovalResponse)
async def save_launch_fields(
    site_id: str,
    body: LaunchFieldsRequest,
    db: DbDep,
    current_user: AdminUser,
    tenant_id: TenantId,
) -> LaunchApprovalResponse:
    """Admin saves / updates editable commercial fields before approving."""
    return await svc_save_fields(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body)


@router.post("/{site_id}/admin-approve", response_model=LaunchApprovalResponse)
async def admin_approve(
    site_id: str,
    db: DbDep,
    current_user: AdminUser,
    tenant_id: TenantId,
) -> LaunchApprovalResponse:
    """Business admin approves after reviewing/editing commercial fields."""
    return await svc_admin_approve(db, tenant_id=tenant_id, actor=current_user, site_id=site_id)


@router.post("/{site_id}/bd-confirm", response_model=LaunchApprovalResponse)
async def bd_confirm(
    site_id: str,
    db: DbDep,
    current_user: BdUser,
    tenant_id: TenantId,
) -> LaunchApprovalResponse:
    """BD (executive / supervisor) confirms the terms."""
    return await svc_bd_confirm(db, tenant_id=tenant_id, actor=current_user, site_id=site_id)


@router.post("/{site_id}/supervisor-approve", response_model=LaunchApprovalResponse)
async def supervisor_approve(
    site_id: str,
    db: DbDep,
    current_user: SupervisorUser,
    tenant_id: TenantId,
) -> LaunchApprovalResponse:
    """Supervisor approves after BD confirmation."""
    return await svc_supervisor_approve(db, tenant_id=tenant_id, actor=current_user, site_id=site_id)


@router.post("/{site_id}/super-admin-approve", response_model=LaunchApprovalResponse)
async def super_admin_approve(
    site_id: str,
    db: DbDep,
    current_user: AdminUser,
    tenant_id: TenantId,
) -> LaunchApprovalResponse:
    """Super admin (business_admin) final approval — unlocks the Launch button."""
    return await svc_super_admin_approve(db, tenant_id=tenant_id, actor=current_user, site_id=site_id)


@router.post("/{site_id}/launch", response_model=LaunchApprovalResponse)
async def launch_site(
    site_id: str,
    db: DbDep,
    current_user: AdminUser,
    tenant_id: TenantId,
) -> LaunchApprovalResponse:
    """Final launch. Sets site.is_launched = True and launch_approvals.status = 'launched'."""
    return await svc_launch(db, tenant_id=tenant_id, actor=current_user, site_id=site_id)
