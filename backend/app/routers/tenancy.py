"""Tenancy router — tenants and cities."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.core.deps import CurrentUser, DbDep, TenantId
from app.db import models
from app.rbac.guards import require_role
from app.rbac.roles import Role

router = APIRouter(prefix="/tenancy", tags=["Tenancy"])


@router.get("/tenants", summary="List tenants (supervisor only)")
async def list_tenants(
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
) -> dict:
    # In a multi-tenant SaaS the supervisor sees only their own tenant. Open
    # this up if/when a "super-supervisor" cross-tenant role is introduced.
    stmt = select(models.Tenant).where(models.Tenant.id == current_user["tenant_id"])
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "items": [{"id": str(t.id), "name": t.name, "slug": t.slug, "plan": t.plan} for t in rows],
        "total": len(rows),
    }


@router.get("/cities", summary="List active cities in tenant")
async def list_cities(
    db: DbDep,
    current_user: CurrentUser,
    tenant_id: TenantId,
) -> dict:
    stmt = (
        select(models.Site.city)
        .where(models.Site.tenant_id == tenant_id)
        .distinct()
        .order_by(models.Site.city)
    )
    rows = [r for (r,) in (await db.execute(stmt)).all()]
    return {"cities": rows}
