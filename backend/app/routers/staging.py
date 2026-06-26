"""Staging router.

Exec staging: all approved + loi_uploaded sites owned by the exec.
Supervisor staging: only loi_uploaded sites (tenant or city scoped).
push_to_payments: loi_uploaded -> pushed_to_payments.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.core.deps import DbDep, TenantId
from app.domain.schemas.common import OkResponse
from app.domain.schemas.site import SiteListResponse
from app.rbac.guards import require_role
from app.rbac.roles import Role
from app.services.bd_service import svc_push_to_payments
from app.services.query_service import list_sites

router = APIRouter(prefix="/staging", tags=["Staging"])


@router.get("/exec", response_model=SiteListResponse, summary="List exec staging sites")
async def list_exec_staging(
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.EXECUTIVE))],
    tenant_id: TenantId,
) -> SiteListResponse:
    out = SiteListResponse(items=[], total=0)
    for st in ("approved", "loi_uploaded", "pushed_to_payments"):
        chunk = await list_sites(db, tenant_id=tenant_id, user=current_user, status=st)
        out.items.extend(chunk.items)
        out.total += chunk.total
    return out


@router.get("/supervisor", response_model=SiteListResponse, summary="List supervisor staging sites")
async def list_supervisor_staging(
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> SiteListResponse:
    return await list_sites(db, tenant_id=tenant_id, user=current_user, status="loi_uploaded")


@router.post(
    "/{site_id}/push",
    response_model=OkResponse,
    status_code=status.HTTP_200_OK,
    summary="Push site to Payments module (supervisor only)",
)
async def push_to_payments(
    site_id: str,
    db: DbDep,
    # Pushing into Payments hands off ownership to Finance and freezes the BD pipeline.
    # This final hand-off is reserved to the supervisor.
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> OkResponse:
    return await svc_push_to_payments(db, tenant_id=tenant_id, actor=current_user, site_id=site_id)
