"""Business-admin portal router.

Endpoints power /business-admin in the frontend. The business admin manages
per-module dept codes and approves/rejects module-supervisor sign-ups.

All routes require Role.BUSINESS_ADMIN.
"""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, status

from app.core.deps import DbDep, TenantId
from app.domain.schemas.business_admin import (
    ApproveSupervisorIn,
    DeptCodeRotateOut,
    FinanceQueueResponse,
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


@router.get("/finance-queue", response_model=FinanceQueueResponse)
async def list_finance_queue(
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
) -> dict:
    """Sites awaiting the business_admin's final finance/payment approval."""
    return await svc.list_finance_admin_queue(db, tenant_id)


@router.get("/org", response_model=OrgResponse)
async def get_org(
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
) -> dict:
    """Per-department code + active supervisors and the executives under them."""
    return await svc.list_org(db, tenant_id)
