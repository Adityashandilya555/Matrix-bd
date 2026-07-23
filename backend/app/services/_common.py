"""Shared service helpers — fetch + tenant scoping + response shaping.

Every persisted query goes through helpers here so tenant scoping and the
SiteResponse mapping live in one place. Routes never build SQL directly.
"""
from __future__ import annotations

import secrets
import string
from datetime import date, datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.domain.schemas.site import SiteResponse
from app.domain.state_machine import SiteStatus
from app.rbac.roles import Role


def is_unique_violation(exc: Exception) -> bool:
    """True if a SQLAlchemy ``IntegrityError`` is a Postgres unique violation
    (SQLSTATE 23505). Probes the asyncpg exception behind the DBAPI adapter
    (``orig`` / ``pgcode`` / ``__cause__``), mirroring the #392 tenancy check.

    Used by the idempotent lazy-create helpers: only a unique race is safe to
    swallow-and-refetch; FK / NOT NULL / CHECK violations must propagate.
    """
    orig = getattr(exc, "orig", None)
    sqlstate = (
        getattr(orig, "sqlstate", None)
        or getattr(orig, "pgcode", None)
        or getattr(getattr(orig, "__cause__", None), "sqlstate", None)
    )
    return sqlstate == "23505" or (sqlstate is None and "unique" in str(exc).lower())


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


async def fetch_site_for_update_or_404(
    session: AsyncSession, *, site_id: str | UUID, tenant_id: str | UUID,
) -> models.Site:
    """Load and row-lock a site for a status-changing workflow mutation."""
    stmt = (
        select(models.Site)
        .where(
            models.Site.id == site_id,
            models.Site.tenant_id == tenant_id,
        )
        .with_for_update()
    )
    site = (await session.execute(stmt)).scalar_one_or_none()
    if site is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Site not found")
    return site


def actor_is_business_admin(actor: dict) -> bool:
    """True when the caller's real identity is a business admin.

    get_current_user always carries the DB role in ``real_role``; ``role`` may
    hold a simulated role while the admin drives another module via the
    X-Override-Role workspace-access header. Falls back to ``role`` for callers
    (tests, legacy actors) that never set ``real_role``.
    """
    return "business_admin" in {
        (actor.get("real_role") or "").lower(),
        (actor.get("role") or "").lower(),
    }


def actor_can_supervise(actor: dict) -> bool:
    """Supervisor-tier gate: an effective supervisor, or a business admin.

    Workspace access lets a business admin run any module's supervisor
    operations, so service-level supervisor checks must not 403 them the way a
    plain role-string comparison would.
    """
    return (actor.get("role") or "").lower() == Role.SUPERVISOR.value or actor_is_business_admin(actor)


def assert_executive_owns_site(actor: dict, site: models.Site) -> None:
    """Raise 403 if the caller is an executive who doesn't own or isn't assigned to the site."""
    if (actor.get("role") or "").lower() != Role.EXECUTIVE.value:
        return
    actor_id = str(actor["sub"])
    if str(site.submitted_by) == actor_id or str(site.assigned_to or "") == actor_id:
        return
    raise HTTPException(
        status_code=http_status.HTTP_403_FORBIDDEN,
        detail="This site is not assigned to you.",
    )


async def fetch_user_name(session: AsyncSession, user_id: str | UUID | None) -> Optional[str]:
    if not user_id:
        return None
    stmt = select(models.User.name).where(models.User.id == user_id)
    return (await session.execute(stmt)).scalar_one_or_none()


async def fetch_user_names(session: AsyncSession, user_ids) -> dict:
    """Batch-resolve ``user_id -> name`` for many ids in a single query. Falsy ids are dropped."""
    ids = {uid for uid in user_ids if uid}
    if not ids:
        return {}
    rows = (await session.execute(
        select(models.User.id, models.User.name).where(models.User.id.in_(ids))
    )).all()
    return dict(rows)


async def count_rows(session: AsyncSession, stmt) -> int:
    """Real ``COUNT(*)`` for a (pre-pagination) SELECT — the accurate result-set total.

    List/queue/history services cap rows at a safety ceiling (#230) so the
    response can't grow unbounded, but the UI still derives KPI counts from the
    set, so ``total`` must be the true count of the filtered query rather than
    ``len(items)`` (which would cap at the page size). Pass the fully-filtered
    statement *before* ``.limit()/.offset()``; ORDER BY is stripped because it is
    irrelevant to a count (and rejected inside some count subqueries).
    """
    result = await session.execute(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    )
    return result.scalar() or 0


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


def _extract_details(details: models.SiteDetail | None, rent: float | None) -> dict:
    if not details:
        return {}
    cam = _float_or_none(details.cam_charges)
    total_op_cost = (rent + cam) * 1.18 if rent is not None and cam is not None else None
    return {
        "score": _float_or_none(details.score),
        "est_sales": _float_or_none(details.estimated_monthly_sales),
        "nearest_starbucks": _float_or_none(details.nearest_starbucks_m),
        "nearest_twc": _float_or_none(details.nearest_twc_m),
        "carpet": _float_or_none(details.carpet_area_sqft),
        "cam": cam,
        "rent": rent,
        "total_op_cost": total_op_cost,
        "escalation": _float_or_none(details.escalation_pct),
        "revshare": _float_or_none(details.rev_share_pct),
        "rent_free_days": _int_or_none(details.rent_free_days),
        "cadex": _float_or_none(details.capex),
        "deposit": _float_or_none(details.security_deposit),
        "brokerage": _float_or_none(details.brokerage),
        "lockin": _int_or_none(details.lock_in_months),
        "tenure": _int_or_none(details.tenure_months),
        "details_saved_at": details.updated_at,
    }

def _extract_project(project: models.ProjectReview | None) -> dict:
    if not project:
        return {}
    return {
        "project_status": project.project_status,
        "project_current_stage": project.current_stage,
    }

def _extract_nso(nso: models.NsoReview | None) -> dict:
    if not nso:
        return {}
    return {
        "nso_status": nso.nso_status,
        "nso_current_stage": nso.current_stage,
    }

async def compute_unseen_supervisor_edits(
    session: AsyncSession, *, tenant_id: str | UUID, site_ids,
) -> dict:
    """Per site, the pipeline fields a supervisor changed that the site's
    executive has not re-viewed yet.

    Audit-derived (no schema change): for each site, collect the field names of
    ``supervisor_field_edited`` events that occurred *after* the most recent
    ``exec_viewed_details`` marker. An empty/absent entry means nothing to flag.
    One query over audit_logs for the whole batch keeps the list view O(1).
    """
    from collections import defaultdict

    from app.services.audit_service import EXEC_VIEWED_ACTION, SUPERVISOR_EDIT_ACTION

    ids = [s for s in site_ids if s]
    if not ids:
        return {}
    rows = (await session.execute(
        select(
            models.AuditLog.site_id,
            models.AuditLog.action,
            models.AuditLog.field_name,
            models.AuditLog.created_at,
        ).where(
            models.AuditLog.tenant_id == tenant_id,
            models.AuditLog.site_id.in_(ids),
            models.AuditLog.action.in_([SUPERVISOR_EDIT_ACTION, EXEC_VIEWED_ACTION]),
        ).order_by(models.AuditLog.created_at)
    )).all()

    last_view: dict = {}
    edits: dict = defaultdict(list)
    for site_id, action, field_name, created_at in rows:
        if action == EXEC_VIEWED_ACTION:
            last_view[site_id] = created_at
        elif field_name:
            edits[site_id].append((created_at, field_name))

    result: dict = {}
    for site_id, entries in edits.items():
        seen_at = last_view.get(site_id)
        unseen: list = []
        for created_at, field_name in entries:
            if (seen_at is None or created_at > seen_at) and field_name not in unseen:
                unseen.append(field_name)
        if unseen:
            result[site_id] = unseen
    return result


def site_to_response(
    site: models.Site,
    created_by_name: str | None = None,
    assigned_to_name: str | None = None,
    details: models.SiteDetail | None = None,
    project: models.ProjectReview | None = None,
    approval: models.Approval | None = None,
    approved_by_name: str | None = None,
    nso: models.NsoReview | None = None,
    launch: models.LaunchApproval | None = None,
    supervisor_edited_fields: list | None = None,
) -> SiteResponse:
    """Map an ORM Site into the API SiteResponse Pydantic model."""
    rent = _float_or_none(site.expected_rent)

    data = {
        "id": str(site.id),
        "code": site.code or "",
        "name": site.name,
        "city": site.city,
        "tenant_id": str(site.tenant_id),
        "status": SiteStatus(site.status),
        "created_by": created_by_name or "",
        "submitted_by": str(site.submitted_by),
        "assigned_to": str(site.assigned_to) if site.assigned_to else None,
        "assigned_to_name": assigned_to_name,
        "supervisor_id": str(site.supervisor_id) if site.supervisor_id else None,
        "visit_date": site.visit_date,
        "days": _days_since(site.visit_date),
        "stage": _legacy_stage_for(site.status),
        "details_completion": None,
        "model": site.model,
        "spoc_name": site.spoc_name,
        "google_pin": site.google_maps_pin,
        "google_maps_url": site.google_maps_url,
        "expected_rent": rent,
        "rent_type": site.rent_type,
        "expected_escalation_pct": _float_or_none(site.expected_escalation_pct),
        "expected_escalation_years": site.expected_escalation_years,
        "expected_revshare_pct": _float_or_none(site.expected_revshare_pct),
        "revshare_dinein_pct": _float_or_none(site.revshare_dinein_pct),
        "revshare_delivery_pct": _float_or_none(site.revshare_delivery_pct),
        "area_sqft": float(site.area_sqft) if site.area_sqft is not None else 0,
        "staggered_escalation": site.staggered_escalation,
        "legal_dd_status": site.legal_dd_status,
        "agreement_status": site.agreement_status,
        "licensing_status": site.licensing_status,
        "design_status": site.design_status,
        "is_launched": bool(site.is_launched),
        "launched_at": site.launched_at,
        "finance_status": site.finance_status or "pending",
        "kyc_verified": bool(site.kyc_verified),
        "ca_code": site.ca_code,
        "finance_amount": _float_or_none(site.finance_amount),
        "approved_at": site.approved_at,
        "approved_by": approved_by_name,
        "loi_uploaded_at": site.loi_uploaded_at,
        "rejection_reason": site.rejection_reason,
        "archive_note": site.archive_note,
        "loi_rejection_note": site.loi_rejection_note,
        "archived_at": site.archived_at,
        "updated_at": site.updated_at,
        "launch_status": launch.status if launch else None,
        "expected_loi_days": approval.expected_loi_days if approval else None,
        "supervisor_edited_fields": supervisor_edited_fields or [],
    }

    data.update(_extract_details(details, rent))
    data.update(_extract_project(project))
    data.update(_extract_nso(nso))

    return SiteResponse(**data)


def _days_since(d: Optional[date]) -> Optional[int]:
    if d is None:
        return None
    return max(0, (datetime.now(timezone.utc).date() - d).days)


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
