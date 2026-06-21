"""NSO (New Store Opening) router."""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.deps import DbDep, TenantId
from app.domain.schemas.common import OkResponse
from app.domain.schemas.nso import (
    AllocateNsoRequest,
    NsoDelegationsResponse,
    NsoHistoryResponse,
    NsoQueueResponse,
    NsoStageOneRequest,
    NsoStageThreeRequest,
    NsoStageTwoRequest,
    NsoStateResponse,
)
from app.rbac.guards import require_module, require_role
from app.rbac.roles import Role
from app.services.delegation_service import svc_assigned_sites
from app.services.nso_service import (
    svc_allocate_nso,
    svc_final_approval,
    svc_get_nso,
    svc_list_nso_delegations_for_site,
    svc_nso_history,
    svc_nso_queue,
    svc_revoke_nso_delegation,
    svc_save_stage_one,
    svc_save_stage_three,
    svc_save_stage_two,
)

router = APIRouter(prefix="/nso", tags=["NSO"])

NsoMember = Annotated[dict, Depends(require_role(Role.SUPERVISOR, Role.EXECUTIVE))]
NsoSupervisor = Annotated[dict, Depends(require_role(Role.SUPERVISOR))]
InNsoModule = Annotated[dict, Depends(require_module("nso"))]


def _is_executive(user: dict) -> bool:
    return (user.get("role") or "").lower() == Role.EXECUTIVE.value


@router.get("/queue", response_model=NsoQueueResponse)
async def nso_queue(
    db: DbDep,
    current_user: NsoMember,
    _module: InNsoModule,
    tenant_id: TenantId,
    limit: int = Query(500, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> NsoQueueResponse:
    restrict_to: Optional[list[str]] = None
    if _is_executive(current_user):
        restrict_to = await svc_assigned_sites(
            db, tenant_id=tenant_id, user_id=current_user["sub"], module="nso",
        )
    return await svc_nso_queue(
        db, tenant_id=tenant_id, restrict_to_site_ids=restrict_to, limit=limit, offset=offset,
    )


@router.get("/history", response_model=NsoHistoryResponse)
async def nso_history(
    db: DbDep,
    _auth: NsoMember,
    _module: InNsoModule,
    tenant_id: TenantId,
    status_filter: str = "all",
    limit: int = Query(500, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> NsoHistoryResponse:
    return await svc_nso_history(
        db, tenant_id=tenant_id, status_filter=status_filter, limit=limit, offset=offset,
    )


@router.get("/history/{site_id}", response_model=NsoStateResponse)
async def nso_history_detail(
    site_id: str,
    db: DbDep,
    _auth: NsoMember,
    _module: InNsoModule,
    tenant_id: TenantId,
) -> NsoStateResponse:
    return await svc_get_nso(db, tenant_id=tenant_id, site_id=site_id, create=False)


@router.get("/{site_id}", response_model=NsoStateResponse)
async def get_nso_site(
    site_id: str,
    db: DbDep,
    _auth: NsoMember,
    _module: InNsoModule,
    tenant_id: TenantId,
) -> NsoStateResponse:
    return await svc_get_nso(db, tenant_id=tenant_id, site_id=site_id)


@router.post("/{site_id}/stage-one", response_model=NsoStateResponse)
@router.patch("/{site_id}/stage-one", response_model=NsoStateResponse)
async def save_nso_stage_one(
    site_id: str,
    body: NsoStageOneRequest,
    db: DbDep,
    current_user: NsoMember,
    _module: InNsoModule,
    tenant_id: TenantId,
) -> NsoStateResponse:
    return await svc_save_stage_one(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body)


@router.post("/{site_id}/stage-two", response_model=NsoStateResponse)
@router.patch("/{site_id}/stage-two", response_model=NsoStateResponse)
async def save_nso_stage_two(
    site_id: str,
    body: NsoStageTwoRequest,
    db: DbDep,
    current_user: NsoMember,
    _module: InNsoModule,
    tenant_id: TenantId,
) -> NsoStateResponse:
    return await svc_save_stage_two(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body)


@router.post("/{site_id}/stage-three", response_model=NsoStateResponse)
@router.patch("/{site_id}/stage-three", response_model=NsoStateResponse)
async def save_nso_stage_three(
    site_id: str,
    body: NsoStageThreeRequest,
    db: DbDep,
    current_user: NsoMember,
    _module: InNsoModule,
    tenant_id: TenantId,
) -> NsoStateResponse:
    return await svc_save_stage_three(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body)


@router.post("/{site_id}/final-approval", response_model=NsoStateResponse)
async def approve_nso_final(
    site_id: str,
    db: DbDep,
    current_user: NsoMember,
    _module: InNsoModule,
    tenant_id: TenantId,
) -> NsoStateResponse:
    return await svc_final_approval(db, tenant_id=tenant_id, actor=current_user, site_id=site_id)


@router.get("/{site_id}/delegations", response_model=NsoDelegationsResponse)
async def list_nso_delegations(
    site_id: str,
    db: DbDep,
    current_user: NsoMember,
    _module: InNsoModule,
    tenant_id: TenantId,
) -> dict:
    if _is_executive(current_user):
        allowed = await svc_assigned_sites(
            db, tenant_id=tenant_id, user_id=current_user["sub"], module="nso",
        )
        if site_id not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This site is not allocated to you.",
            )
    return await svc_list_nso_delegations_for_site(db, tenant_id=tenant_id, site_id=site_id)


@router.post("/{site_id}/allocate", response_model=NsoDelegationsResponse)
async def allocate_nso(
    site_id: str,
    body: AllocateNsoRequest,
    db: DbDep,
    current_user: NsoSupervisor,
    _module: InNsoModule,
    tenant_id: TenantId,
) -> dict:
    return await svc_allocate_nso(
        db,
        tenant_id=tenant_id,
        actor=current_user,
        site_id=site_id,
        delegate_user_id=body.executive_id,
        notes=body.notes,
    )


@router.delete("/{site_id}/allocate/{user_id}", response_model=OkResponse)
async def revoke_nso_allocation(
    site_id: str,
    user_id: str,
    db: DbDep,
    current_user: NsoSupervisor,
    _module: InNsoModule,
    tenant_id: TenantId,
) -> OkResponse:
    return await svc_revoke_nso_delegation(
        db,
        tenant_id=tenant_id,
        actor=current_user,
        site_id=site_id,
        delegate_user_id=user_id,
    )
