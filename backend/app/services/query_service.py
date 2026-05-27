"""Read-side query helpers — list_sites, get_site, activity feed, audit list.

Splitting these out of bd_service keeps the write-side service file focused on
state machine transitions.
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.domain.schemas.audit import AuditEvent, AuditListResponse
from app.domain.schemas.site import SiteListResponse, SiteResponse
from app.services._common import apply_role_scope, fetch_site_or_404, site_to_response


# Slice U3 adds a `stage` column on legal_dd_checklist + site_licensing
# (draft / pending_review / published). BD must only see published rows. Use
# getattr with a 'published' default so we keep working pre-U3.

_DD_BD_FIELDS = (
    "title_doc", "sanctioned_plan", "oc_cc", "commercial_use", "property_tax",
    "electricity", "fire_noc", "other_1", "other_2",
    "final_verdict", "rejection_reason",
)
_LICENSING_BD_FIELDS = (
    "fssai", "health_trade", "shops_estab_reg", "fire_noc", "storage_license",
)


def _row_stage(row) -> str:
    try:
        return getattr(row, "stage", "published") or "published"
    except Exception:  # pragma: no cover — defensive
        return "published"


def _project_for_caller(row, fields: tuple[str, ...], *, module: Optional[str]) -> dict:
    if row is None:
        return {"stage": "absent", "items_visible": False}
    stage = _row_stage(row)
    bd_caller = (module or "").lower() == "bd"
    if bd_caller and stage != "published":
        return {"stage": stage, "items_visible": False}
    out = {"stage": stage, "items_visible": True}
    for f in fields:
        out[f] = getattr(row, f, None)
    return out


def project_dd_for_caller(row, *, module: Optional[str]) -> dict:
    """BD callers see published DD rows only; legal staff see everything."""
    return _project_for_caller(row, _DD_BD_FIELDS, module=module)


def project_licensing_for_caller(row, *, module: Optional[str]) -> dict:
    """BD callers see published licensing rows only; legal staff see everything."""
    return _project_for_caller(row, _LICENSING_BD_FIELDS, module=module)


async def list_sites(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    user: dict,
    status: Optional[str] = None,
    city: Optional[str] = None,
    limit: int = 200,
) -> SiteListResponse:
    stmt = select(models.Site).where(models.Site.tenant_id == tenant_id)
    if status:
        stmt = stmt.where(models.Site.status == status)
    if city:
        stmt = stmt.where(models.Site.city == city)
    stmt = apply_role_scope(stmt, model=models.Site, user=user)
    stmt = stmt.order_by(desc(models.Site.updated_at)).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()

    # Resolve names for the SiteResponse.created_by field in one query.
    submitter_ids = {r.submitted_by for r in rows if r.submitted_by}
    names = {}
    if submitter_ids:
        u_stmt = select(models.User.id, models.User.name).where(models.User.id.in_(submitter_ids))
        names = dict((u_id, n) for u_id, n in (await session.execute(u_stmt)).all())

    items = [site_to_response(r, created_by_name=names.get(r.submitted_by, "")) for r in rows]
    return SiteListResponse(items=items, total=len(items))


async def get_site(
    session: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID, user: dict,
) -> SiteResponse:
    site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
    # role scope re-check: an exec must not be able to read another exec's site
    from app.rbac.roles import Role

    if user["role"] == Role.EXECUTIVE.value:
        if str(site.submitted_by) != user["sub"] and str(site.assigned_to or "") != user["sub"]:
            from fastapi import HTTPException, status as http_status
            raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Forbidden")

    name_stmt = select(models.User.name).where(models.User.id == site.submitted_by)
    name = (await session.execute(name_stmt)).scalar_one_or_none()
    return site_to_response(site, created_by_name=name or "")


async def list_site_activity(
    session: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID, limit: int = 100,
) -> AuditListResponse:
    stmt = (
        select(models.AuditLog)
        .where(models.AuditLog.tenant_id == tenant_id, models.AuditLog.site_id == site_id)
        .order_by(desc(models.AuditLog.created_at))
        .limit(limit)
    )
    rows = (await session.execute(stmt)).scalars().all()
    items = [_audit_to_event(r) for r in rows]
    return AuditListResponse(items=items, total=len(items))


async def list_tenant_audit(
    session: AsyncSession, *, tenant_id: str | UUID, page: int = 1, limit: int = 50,
) -> AuditListResponse:
    offset = max(0, (page - 1) * limit)
    stmt = (
        select(models.AuditLog)
        .where(models.AuditLog.tenant_id == tenant_id)
        .order_by(desc(models.AuditLog.created_at))
        .limit(limit).offset(offset)
    )
    rows = (await session.execute(stmt)).scalars().all()
    total = (await session.execute(
        select(func.count(models.AuditLog.id)).where(models.AuditLog.tenant_id == tenant_id)
    )).scalar_one()
    return AuditListResponse(items=[_audit_to_event(r) for r in rows], total=int(total))


def _audit_to_event(r: models.AuditLog) -> AuditEvent:
    return AuditEvent(
        id=str(r.id),
        site_id=str(r.site_id) if r.site_id else None,
        actor=r.actor_name or "system",
        action=r.action,
        from_status=r.from_status,
        to_status=r.to_status,
        detail=r.detail,
        field_name=r.field_name,
        from_value=r.from_value,
        to_value=r.to_value,
        created_at=r.created_at,
    )
