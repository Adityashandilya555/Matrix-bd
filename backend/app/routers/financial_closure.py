"""Financial Closure router — post-launch 'closure' budget phase (a tab in the
Project surface). Members are project supervisors/executives; the open + finalize
actions are business_admin."""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.deps import DbDep, TenantId
from app.domain.schemas.common import OkResponse
from app.domain.schemas.financial_closure import (
    AllocateFCRequest,
    FCAdminReviewRequest,
    FCDelegationsResponse,
    FCQueueResponse,
    FCReviewRequest,
    FCStateResponse,
    SaveFCBudgetRequest,
)
from app.rbac.guards import require_module, require_role
from app.rbac.roles import Role
from app.services.delegation_service import svc_assigned_sites, svc_is_delegated
from app.services.financial_closure_service import (
    svc_admin_finalize_fc,
    svc_allocate_fc,
    svc_fc_admin_queue,
    svc_fc_queue,
    svc_get_fc,
    svc_get_fc_admin_detail,
    svc_list_fc_delegations_for_site,
    svc_review_fc_budget,
    svc_revoke_fc_delegation,
    svc_save_fc_budget,
    svc_send_for_financial_closure,
)

router = APIRouter(prefix="/financial-closure", tags=["Financial Closure"])

FCMember = Annotated[dict, Depends(require_role(Role.SUPERVISOR, Role.EXECUTIVE))]
FCSupervisor = Annotated[dict, Depends(require_role(Role.SUPERVISOR))]
InProjectModule = Annotated[dict, Depends(require_module("project"))]
BusinessAdmin = Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))]

_MODULE = "financial_closure"


def _is_executive(user: dict) -> bool:
    return (user.get("role") or "").lower() == Role.EXECUTIVE.value


@router.post("/{site_id}/send", response_model=FCStateResponse)
async def send_for_financial_closure(
    site_id: str, db: DbDep, current_user: BusinessAdmin, tenant_id: TenantId,
) -> FCStateResponse:
    """Admin opens Financial Closure for a launched site (the 'Send for financial closure' button)."""
    return await svc_send_for_financial_closure(db, tenant_id=tenant_id, actor=current_user, site_id=site_id)


@router.get("/queue", response_model=FCQueueResponse)
async def fc_queue(
    db: DbDep, current_user: FCMember, _module: InProjectModule, tenant_id: TenantId,
    limit: int = Query(500, ge=1, le=1000), offset: int = Query(0, ge=0),
) -> FCQueueResponse:
    restrict_to: Optional[list[str]] = None
    if _is_executive(current_user):
        restrict_to = await svc_assigned_sites(db, tenant_id=tenant_id, user_id=current_user["sub"], module=_MODULE)
    return await svc_fc_queue(
        db, tenant_id=tenant_id, restrict_to_site_ids=restrict_to, limit=limit, offset=offset,
    )


@router.get("/admin-queue", response_model=FCQueueResponse)
async def fc_admin_queue(
    db: DbDep, _auth: BusinessAdmin, tenant_id: TenantId,
    limit: int = Query(500, ge=1, le=1000), offset: int = Query(0, ge=0),
) -> FCQueueResponse:
    return await svc_fc_admin_queue(db, tenant_id=tenant_id, limit=limit, offset=offset)


@router.get("/admin-detail/{site_id}", response_model=FCStateResponse)
async def fc_admin_detail(
    site_id: str, db: DbDep, _auth: BusinessAdmin, tenant_id: TenantId,
) -> FCStateResponse:
    return await svc_get_fc_admin_detail(db, tenant_id=tenant_id, site_id=site_id)


@router.post("/{site_id}/finalize", response_model=FCStateResponse)
async def finalize_financial_closure(
    site_id: str, body: FCAdminReviewRequest, db: DbDep, current_user: BusinessAdmin, tenant_id: TenantId,
) -> FCStateResponse:
    """The admin's Financial Closure button — records closure + archives to history."""
    return await svc_admin_finalize_fc(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body)


@router.get("/{site_id}/delegations", response_model=FCDelegationsResponse)
async def list_fc_delegations(
    site_id: str, db: DbDep, current_user: FCMember, _module: InProjectModule, tenant_id: TenantId,
) -> dict:
    if _is_executive(current_user):
        allowed = await svc_assigned_sites(db, tenant_id=tenant_id, user_id=current_user["sub"], module=_MODULE)
        if site_id not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This site is not allocated to you.")
    return await svc_list_fc_delegations_for_site(db, tenant_id=tenant_id, site_id=site_id)


@router.post("/{site_id}/allocate", response_model=FCStateResponse)
async def allocate_fc(
    site_id: str, body: AllocateFCRequest, db: DbDep, current_user: FCSupervisor, _module: InProjectModule, tenant_id: TenantId,
) -> FCStateResponse:
    return await svc_allocate_fc(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, delegate_user_id=body.executive_id, notes=body.notes)


@router.delete("/{site_id}/allocate/{user_id}", response_model=OkResponse)
async def revoke_fc_allocation(
    site_id: str, user_id: str, db: DbDep, current_user: FCSupervisor, _module: InProjectModule, tenant_id: TenantId,
) -> OkResponse:
    return await svc_revoke_fc_delegation(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, delegate_user_id=user_id)


@router.post("/{site_id}/budget", response_model=FCStateResponse)
async def save_fc_budget(
    site_id: str, body: SaveFCBudgetRequest, db: DbDep, current_user: FCMember, _module: InProjectModule, tenant_id: TenantId,
) -> FCStateResponse:
    return await svc_save_fc_budget(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body)


@router.post("/{site_id}/budget/review", response_model=FCStateResponse)
async def review_fc_budget(
    site_id: str, body: FCReviewRequest, db: DbDep, current_user: FCSupervisor, _module: InProjectModule, tenant_id: TenantId,
) -> FCStateResponse:
    return await svc_review_fc_budget(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body)


@router.get("/{site_id}", response_model=FCStateResponse)
async def get_fc(
    site_id: str, db: DbDep, current_user: FCMember, _module: InProjectModule, tenant_id: TenantId,
) -> FCStateResponse:
    if _is_executive(current_user):
        ok = await svc_is_delegated(db, tenant_id=tenant_id, site_id=site_id, user_id=current_user["sub"], module=_MODULE)
        if not ok:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    return await svc_get_fc(db, tenant_id=tenant_id, site_id=site_id)
