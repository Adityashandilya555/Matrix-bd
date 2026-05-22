"""Shared service helpers — fetch + tenant scoping + response shaping.

Every persisted query goes through helpers here so tenant scoping and the
SiteResponse mapping live in one place. Routes never build SQL directly.
"""
from __future__ import annotations

import secrets
import string
from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.domain.schemas.site import SiteResponse
from app.domain.state_machine import SiteStatus
from app.rbac.roles import Role


# ── Site code generator ────────────────────────────────────────────────────

_CODE_ALPHABET = string.ascii_uppercase + string.digits


def make_site_code(city: str) -> str:
    """`BT-MUM-A12C` style display code. Not a primary key — readability only."""
    prefix = (city[:3] or "XXX").upper()
    suffix = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(4))
    return f"BT-{prefix}-{suffix}"


# ── Scoped fetch ───────────────────────────────────────────────────────────

async def fetch_site_or_404(
    session: AsyncSession, *, site_id: str | UUID, tenant_id: str | UUID,
) -> models.Site:
    """Load a site by id, scoped to tenant. Raises 404 if not found."""
    stmt = select(models.Site).where(
        models.Site.id == site_id,
        models.Site.tenant_id == tenant_id,
    )
    site = (await session.execute(stmt)).scalar_one_or_none()
    if site is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Site not found")
    return site


async def fetch_user_name(session: AsyncSession, user_id: str | UUID | None) -> Optional[str]:
    if not user_id:
        return None
    stmt = select(models.User.name).where(models.User.id == user_id)
    return (await session.execute(stmt)).scalar_one_or_none()


# ── Scope filter for list queries ─────────────────────────────────────────

def apply_role_scope(stmt, *, model, user: dict):
    """Add WHERE clauses according to the caller's role.

    - executive: only sites they submitted (or are assigned to).
    - supervisor: all sites in the tenant.
    - sub_supervisor: all sites in the tenant that match the user's city.

    Tenant scoping is the caller's responsibility (already applied by the
    `tenant_id == ...` clause); this layer adds role-specific WHEREs.
    """
    role = user["role"]
    if role == Role.EXECUTIVE.value:
        uid = user["sub"]
        stmt = stmt.where((model.submitted_by == uid) | (model.assigned_to == uid))
    elif role == Role.SUB_SUPERVISOR.value and user.get("city"):
        stmt = stmt.where(model.city == user["city"])
    # supervisor / system: no further filter
    return stmt


# ── Site → SiteResponse mapping ───────────────────────────────────────────

def site_to_response(site: models.Site, created_by_name: str | None = None) -> SiteResponse:
    """Map an ORM Site into the API SiteResponse Pydantic model."""
    return SiteResponse(
        id=str(site.id),
        code=site.code or "",
        name=site.name,
        city=site.city,
        tenant_id=str(site.tenant_id),
        status=SiteStatus(site.status),
        created_by=created_by_name or "",
        visit_date=site.visit_date,
        days=_days_since(site.visit_date),
        stage=_legacy_stage_for(site.status),
        details_completion=None,
        model=site.model,
        spoc_name=site.spoc_name,
        google_pin=site.google_maps_pin,
        expected_rent=float(site.expected_rent) if site.expected_rent is not None else None,
        rent_type=site.rent_type,
    )


def _days_since(d: Optional[date]) -> Optional[int]:
    if d is None:
        return None
    return max(0, (date.today() - d).days)


def _legacy_stage_for(status: str) -> str:
    return {
        "draft_submitted": "draft",
        "shortlisted": "shortlist",
        "details_submitted": "shortlist",
        "approved": "staging",
        "loi_uploaded": "staging",
        "pushed_to_payments": "staging",
        "rejected": "archive",
        "archived": "archive",
    }.get(status, "draft")
