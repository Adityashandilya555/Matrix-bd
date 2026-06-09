"""NSO (New Store Opening) router."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.deps import DbDep, TenantId
from app.domain.schemas.nso import (
    NsoHistoryResponse,
    NsoQueueResponse,
    NsoStageOneRequest,
    NsoStageThreeRequest,
    NsoStageTwoRequest,
    NsoStateResponse,
)
from app.rbac.guards import require_module, require_role
from app.rbac.roles import Role
from app.services.nso_service import (
    svc_final_approval,
    svc_get_nso,
    svc_nso_history,
    svc_nso_queue,
    svc_save_stage_one,
    svc_save_stage_three,
    svc_save_stage_two,
)

router = APIRouter(prefix="/nso", tags=["NSO"])

NsoMember = Annotated[dict, Depends(require_role(Role.SUPERVISOR, Role.EXECUTIVE))]
InNsoModule = Annotated[dict, Depends(require_module("nso"))]


@router.get("/queue", response_model=NsoQueueResponse)
async def nso_queue(
    db: DbDep,
    current_user: NsoMember,
    _module: InNsoModule,
    tenant_id: TenantId,
) -> NsoQueueResponse:
    return await svc_nso_queue(db, tenant_id=tenant_id)


@router.get("/history", response_model=NsoHistoryResponse)
async def nso_history(
    db: DbDep,
    current_user: NsoMember,
    _module: InNsoModule,
    tenant_id: TenantId,
    status_filter: str = "all",
) -> NsoHistoryResponse:
    return await svc_nso_history(db, tenant_id=tenant_id, status_filter=status_filter)


@router.get("/history/{site_id}", response_model=NsoStateResponse)
async def nso_history_detail(
    site_id: str,
    db: DbDep,
    current_user: NsoMember,
    _module: InNsoModule,
    tenant_id: TenantId,
) -> NsoStateResponse:
    return await svc_get_nso(db, tenant_id=tenant_id, site_id=site_id, create=False)


@router.get("/{site_id}", response_model=NsoStateResponse)
async def get_nso_site(
    site_id: str,
    db: DbDep,
    current_user: NsoMember,
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
