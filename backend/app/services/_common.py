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

    Tenant scoping is the caller's responsibility (already applied by the
    `tenant_id == ...` clause); this layer adds role-specific WHEREs.
    """
    role = user["role"]
    if role == Role.EXECUTIVE.value:
        uid = user["sub"]
        stmt = stmt.where((model.submitted_by == uid) | (model.assigned_to == uid))
    # supervisor / system: no further filter
    return stmt


# ── Site → SiteResponse mapping ───────────────────────────────────────────

def _float_or_none(value) -> float | None:
    return float(value) if value is not None else None


def _int_or_none(value) -> int | None:
    return int(value) if value is not None else None


def site_to_response(
    site: models.Site,
    created_by_name: str | None = None,
    details: models.SiteDetail | None = None,
) -> SiteResponse:
    """Map an ORM Site into the API SiteResponse Pydantic model."""
    rent = _float_or_none(site.expected_rent)
    cam = _float_or_none(details.cam_charges) if details else None
    total_op_cost = (rent + cam) * 1.18 if rent is not None and cam is not None else None
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
        google_maps_url=site.google_maps_url,
        expected_rent=rent,
        rent_type=site.rent_type,
        expected_escalation_pct=_float_or_none(site.expected_escalation_pct),
        expected_escalation_years=site.expected_escalation_years,
        expected_revshare_pct=_float_or_none(site.expected_revshare_pct),
        score=_float_or_none(details.score) if details else None,
        est_sales=_float_or_none(details.estimated_monthly_sales) if details else None,
        nearest_starbucks=_float_or_none(details.nearest_starbucks_m) if details else None,
        nearest_twc=_float_or_none(details.nearest_twc_m) if details else None,
        carpet=_float_or_none(details.carpet_area_sqft) if details else None,
        cam=cam,
        rent=rent,
        total_op_cost=total_op_cost,
        escalation=_float_or_none(details.escalation_pct) if details else None,
        revshare=_float_or_none(details.rev_share_pct) if details else None,
        rent_free_days=_int_or_none(details.rent_free_days) if details else None,
        cadex=_float_or_none(details.capex) if details else None,
        deposit=_float_or_none(details.security_deposit) if details else None,
        brokerage=_float_or_none(details.brokerage) if details else None,
        lockin=_int_or_none(details.lock_in_months) if details else None,
        tenure=_int_or_none(details.tenure_months) if details else None,
        details_saved_at=details.updated_at if details else None,
        legal_dd_status=site.legal_dd_status,
        agreement_status=site.agreement_status,
        licensing_status=site.licensing_status,
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
