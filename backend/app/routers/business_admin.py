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
    SiteDocumentsResponse,
    ExecutiveRequestOut,
)
from app.rbac.guards import require_role
from app.rbac.roles import Role
from app.services import business_admin_documents_service as docs_svc
from app.services import business_admin_service as svc

router = APIRouter(prefix="/business-admin", tags=["Business Admin"])


@router.get("/dept-codes", response_model=list[ModuleCodeOut])
async def list_dept_codes(
    db: DbDep,
    _auth: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
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
    _auth: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
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
    _auth: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
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
    _auth: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
) -> None:
    await svc.reject_supervisor(db, tenant_id, user_id)


@router.get("/executive-requests", response_model=list[ExecutiveRequestOut])
async def list_executive_requests(
    db: DbDep,
    _auth: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
) -> list[dict]:
    return await svc.list_executive_requests(db, tenant_id)


@router.post(
    "/executive-requests/{request_id}/approve",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def approve_executive_request(
    request_id: str,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
) -> None:
    await svc.approve_executive_request(db, tenant_id, request_id, current_user["sub"])


@router.post(
    "/executive-requests/{request_id}/reject",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def reject_executive_request(
    request_id: str,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
) -> None:
    await svc.reject_executive_request(db, tenant_id, request_id, current_user["sub"])



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
    _auth: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
    limit: int = 200,
    offset: int = 0,
) -> dict:
    return await svc.list_admin_sites(db, tenant_id, limit=limit, offset=offset)


@router.delete(
    "/sites/{site_id}",
    summary="Permanently delete a site and everything attached to it",
    description=(
        "Hard delete — not archive. Removes the site plus its details, documents, "
        "audit trail, approvals, budgets and every module's rows via FK cascade, "
        "and frees its CA code. Not recoverable; the UI gates it behind two "
        "confirmations. The deletion itself is recorded in audit_logs."
    ),
)
async def delete_site(
    site_id: str,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
) -> dict:
    """Permanently delete a site and everything cascading from it.

    Business-admin only, and the one hard-delete in the product — archive stays
    the reversible path. The service row-locks and tenant-scopes the site, so a
    forged id from another workspace is a 404.
    """
    return await svc.delete_site(db, tenant_id, site_id, current_user)


@router.get("/finance-approvals", response_model=list[FinanceApprovalOut])
async def list_finance_approvals(
    db: DbDep,
    _auth: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
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
    _auth: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
) -> dict:
    """Per-department code + active supervisors and the executives under them."""
    return await svc.list_org(db, tenant_id)


@router.get("/sites/{site_id}/documents", response_model=SiteDocumentsResponse)
async def list_site_documents(
    site_id: str,
    db: DbDep,
    _auth: Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
) -> dict:
    """Every document uploaded for a site across its lifecycle (LOI, photos,
    quality-audit, design deliverables), with signed download URLs. Available even
    after the site is closed, so the admin can review the paperwork later."""
    return await docs_svc.list_site_documents(db, tenant_id=tenant_id, site_id=site_id)
