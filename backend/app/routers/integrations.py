"""Business-admin routes for the NSO platform webhook integration.

All routes use require_real_role(BUSINESS_ADMIN): two of them return the
signing secret, and none of them should be reachable through an observer's
read-all bypass or a role override.
"""
from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
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


@router.get("/sites/lookup")
async def lookup_site(
    db: DbDep, _admin: AdminUser, tenant_id: TenantId, ca_code: Annotated[str, Query(max_length=100)] = "",
) -> dict[str, Any]:
    """Find a site by CA code and say whether it can be sent to NSO."""
    return await svc.lookup_site(db, tenant_id, ca_code)


@router.post("/sites/{site_id}/resend")
async def resend_site(site_id: uuid.UUID, db: DbDep, admin: AdminUser, tenant_id: TenantId) -> dict[str, Any]:
    """Send this site's current data to NSO again as a new event."""
    return await svc.resend_site(db, tenant_id, admin, site_id)


@router.get("/sites")
async def list_sites(
    db: DbDep, _admin: AdminUser, tenant_id: TenantId,
    q: Annotated[str, Query(max_length=100)] = "", page: Annotated[int, Query(ge=1, le=10_000)] = 1,
) -> dict[str, Any]:
    """One row per site sent to NSO, latest activity first, with its current state."""
    return await svc.list_sites(db, tenant_id, q, page)


@router.get("/sites/{site_id}/history")
async def site_history(site_id: uuid.UUID, db: DbDep, _admin: AdminUser, tenant_id: TenantId) -> dict[str, Any]:
    """Every event for one site: what changed each time, and NSO's reply to each attempt."""
    return await svc.site_history(db, tenant_id, site_id)


@router.get("/events/{outbox_id}")
async def get_event(outbox_id: uuid.UUID, db: DbDep, _admin: AdminUser, tenant_id: TenantId) -> dict[str, Any]:
    """The exact data sent for one event, and NSO's reply to each attempt."""
    return await svc.get_event(db, tenant_id, outbox_id)


@router.post("/dead/{outbox_id}/replay")
async def replay(outbox_id: uuid.UUID, db: DbDep, admin: AdminUser, tenant_id: TenantId) -> dict[str, Any]:
    """Queue one dead event again."""
    return await svc.replay(db, tenant_id, admin, outbox_id)
