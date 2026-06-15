"""Business-admin portal router.

Endpoints power /business-admin in the frontend. The business admin manages
per-module dept codes and approves/rejects module-supervisor sign-ups.

All routes require Role.BUSINESS_ADMIN.
"""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel

from app.core.deps import DbDep, TenantId
from app.domain.schemas.business_admin import (
    ApproveSupervisorIn,
    AdminSitesResponse,
    DeptCodeRotateOut,
    FinanceApprovalOut,
    Module,
    ModuleCodeOut,
    OrgResponse,
    PendingSupervisorOut,
)
from app.rbac.guards import require_role
from app.rbac.roles import Role
from app.services import business_admin_service as svc

router = APIRouter(prefix="/business-admin", tags=["Business Admin"])


@router.get("/dept-codes", response_model=list[ModuleCodeOut])
async def list_dept_codes(
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
) -> list[dict]:
    return await svc.list_dept_codes(db, tenant_id)


@router.post("/dept-codes/{module}/rotate", response_model=DeptCodeRotateOut)
async def rotate_dept_code(
    module: Module,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
) -> dict:
    return await svc.rotate_dept_code(db, tenant_id, module, current_user["sub"])


@router.get("/pending-supervisors", response_model=list[PendingSupervisorOut])
async def list_pending_supervisors(
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
    module: Optional[Module] = None,
) -> list[dict]:
    return await svc.list_pending_supervisors(db, tenant_id, module)


@router.post(
    "/pending-supervisors/{user_id}/approve",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def approve_supervisor(
    user_id: str,
    payload: ApproveSupervisorIn,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
) -> None:
    await svc.approve_supervisor(db, tenant_id, user_id, payload.module)


@router.post(
    "/pending-supervisors/{user_id}/reject",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def reject_supervisor(
    user_id: str,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
) -> None:
    await svc.reject_supervisor(db, tenant_id, user_id)


@router.post(
    "/org/{user_id}/remove",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_org_user(
    user_id: str,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
) -> None:
    """Deactivate an org user (supervisor/executive) — revokes their access."""
    await svc.deactivate_org_user(db, tenant_id, user_id, current_user)


@router.get("/sites", response_model=AdminSitesResponse)
async def list_admin_sites(
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
    limit: int = 80,
) -> dict:
    return await svc.list_admin_sites(db, tenant_id, limit=limit)


@router.get("/finance-approvals", response_model=list[FinanceApprovalOut])
async def list_finance_approvals(
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
) -> list[dict]:
    return await svc.list_finance_approvals(db, tenant_id)


@router.post(
    "/finance-approvals/{site_id}/approve",
    response_model=dict,
)
async def approve_finance(
    site_id: str,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
) -> dict:
    return await svc.approve_finance(db, tenant_id, site_id, current_user)


class _FinanceRejectBody(BaseModel):
    reason: Optional[str] = None


@router.post(
    "/finance-approvals/{site_id}/reject",
    response_model=dict,
    summary="Admin sends a finance request back for correction",
    description="awaiting_admin → pending. Unlocks KYC / CA code / amount so the executive can fix and re-request approval.",
)
async def reject_finance(
    site_id: str,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
    body: _FinanceRejectBody | None = None,
) -> dict:
    return await svc.reject_finance(
        db, tenant_id, site_id, current_user,
        reason=(body.reason if body else None),
    )


@router.get("/org", response_model=OrgResponse)
async def get_org(
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
) -> dict:
    """Per-department code + active supervisors and the executives under them."""
    return await svc.list_org(db, tenant_id)
