"""Business-admin routes for the NSO platform webhook integration.

All routes use require_real_role(BUSINESS_ADMIN): two of them return the
signing secret, and none of them should be reachable through an observer's
read-all bypass or a role override.
"""
from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.core.deps import DbDep, TenantId
from app.rbac.guards import require_real_role
from app.rbac.roles import Role
from app.services import integration_service as svc

router = APIRouter(prefix="/business-admin/integrations/nso", tags=["Integrations"])

AdminUser = Annotated[dict, Depends(require_real_role(Role.BUSINESS_ADMIN))]


class NsoSettingsIn(BaseModel):
    """Endpoint settings sent by the business-admin panel."""
    endpoint_url: str = Field(..., min_length=9, max_length=2000)
    enabled: bool


@router.get("")
async def get_settings(db: DbDep, _admin: AdminUser, tenant_id: TenantId) -> dict[str, Any]:
    """Settings, queue counts and the last deliveries."""
    return await svc.get_config(db, tenant_id)


@router.put("")
async def put_settings(body: NsoSettingsIn, db: DbDep, admin: AdminUser, tenant_id: TenantId) -> dict[str, Any]:
    """Save URL and on/off. The first save returns the signing secret once."""
    return await svc.save_config(db, tenant_id, admin, body.endpoint_url, body.enabled)


@router.post("/rotate-secret")
async def rotate_secret(db: DbDep, admin: AdminUser, tenant_id: TenantId) -> dict[str, Any]:
    """New secret, returned once; the old one keeps working for 24 hours."""
    return await svc.rotate_secret(db, tenant_id, admin)


@router.post("/test")
async def send_test(db: DbDep, admin: AdminUser, tenant_id: TenantId) -> dict[str, Any]:
    """Queue a site.test event."""
    return await svc.send_test(db, tenant_id, admin)


@router.post("/backfill")
async def backfill(db: DbDep, admin: AdminUser, tenant_id: TenantId) -> dict[str, Any]:
    """Queue every eligible site that NSO doesn't already have up to date."""
    return await svc.backfill(db, tenant_id, admin)


@router.get("/dead")
async def list_dead(db: DbDep, _admin: AdminUser, tenant_id: TenantId) -> list[dict[str, Any]]:
    """Events that gave up, newest first."""
    return await svc.list_dead(db, tenant_id)


@router.post("/dead/{outbox_id}/replay")
async def replay(outbox_id: uuid.UUID, db: DbDep, admin: AdminUser, tenant_id: TenantId) -> dict[str, Any]:
    """Queue one dead event again."""
    return await svc.replay(db, tenant_id, admin, outbox_id)
