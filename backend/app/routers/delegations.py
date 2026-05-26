"""Shortlist delegation router.

Thin HTTP layer on top of `app.services.delegation_service`. See that module
for the business rules. Three resource shapes:

    POST   /sites/{site_id}/delegations    — grant (supervisor only)
    GET    /sites/{site_id}/delegations    — list active (supervisor / executive)
    DELETE /delegations/{delegation_id}    — revoke (supervisor only)
    GET    /delegations/mine               — active delegations for caller
"""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.core.deps import DbDep, TenantId
from app.domain.schemas.common import OkResponse
from app.rbac.guards import require_role
from app.rbac.roles import Role
from app.services.delegation_service import (
    svc_grant_delegation,
    svc_list_delegations_for_site,
    svc_list_my_delegations,
    svc_revoke_delegation,
)

router = APIRouter(tags=["Delegations"])


class GrantDelegationRequest(BaseModel):
    delegate_user_id: str = Field(min_length=4)
    notes:            Optional[str] = Field(default=None, max_length=400)


@router.post(
    "/sites/{site_id}/delegations",
    summary="Supervisor: delegate shortlist authority on a site",
)
async def grant_delegation(
    site_id: str,
    body: GrantDelegationRequest,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> dict:
    return await svc_grant_delegation(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
        delegate_user_id=body.delegate_user_id, notes=body.notes,
    )


@router.get(
    "/sites/{site_id}/delegations",
    summary="List active delegations on a site",
)
async def list_site_delegations(
    site_id: str,
    db: DbDep,
    current_user: Annotated[
        dict, Depends(require_role(Role.SUPERVISOR, Role.EXECUTIVE))
    ],
    tenant_id: TenantId,
) -> dict:
    return await svc_list_delegations_for_site(db, tenant_id=tenant_id, site_id=site_id)


@router.delete(
    "/delegations/{delegation_id}",
    response_model=OkResponse,
    summary="Supervisor: revoke a delegation",
)
async def revoke_delegation(
    delegation_id: str,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> OkResponse:
    return await svc_revoke_delegation(
        db, tenant_id=tenant_id, actor=current_user, delegation_id=delegation_id,
    )


@router.get(
    "/delegations/mine",
    summary="Active delegations granted to the caller",
)
async def list_my_delegations(
    db: DbDep,
    current_user: Annotated[
        dict, Depends(require_role(Role.SUPERVISOR, Role.EXECUTIVE))
    ],
    tenant_id: TenantId,
) -> dict:
    return await svc_list_my_delegations(db, tenant_id=tenant_id, actor=current_user)
