"""Role dashboards: one summary payload per caller, plus a cheap change detector.

Two entry points:

  * ``get_version`` runs one statement that folds the tenant's latest audit
    event and the latest update on every table a dashboard reads into a short
    hash. The frontend polls it every 15 seconds and reloads the summary only
    when the hash moves.
  * ``build_summary`` returns the sections the caller's role may see. Every
    section is optional: the frontend draws whatever is present.

Who sees what
-------------
The builder is picked from the EFFECTIVE role and module (``role`` /
``module``), which already reflect a workspace-access simulation. ``real_role``
is only read to tell a real business admin or observer apart from someone who
merely appears as one.

  * business admin / observer: tenant-wide, every section.
  * supervisor: whole module, or "My team" with ``scope=team``. A supervisor of
    any module other than BD gets no BD numbers.
  * executive: their own BD sites (submitted or assigned, the same rule as
    ``_common.apply_role_scope``) or, in another module, sites delegated to them
    through an active ``site_delegations`` row for that module or its companion.
    Never money, people or tenant-wide queues.
  * an admin or observer simulating an executive gets the supervisor-shaped
    module view with ``simulated: true``. Filtering by their own user id would
    show an empty personal dashboard.

The app connects with a role that bypasses row-level security, so every query
below filters ``sites.tenant_id`` itself. Raw SQL is always one whole
``text()`` literal with bound parameters; everything that has to be composed
(the per-role site scope) is built with SQLAlchemy Core instead of strings.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException, status as http_status
from sqlalchemy import and_, case, exists, func, literal, or_, select, text, true
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.db import models
from app.rbac.roles import READ_ALL_ROLES, Role
from app.services.executive_module_access_service import _COMPANION_DELEGATION_MODULE

S = models.Site

# Statuses after which a site no longer moves through the BD pipeline.
_CLOSED = ("rejected", "archived", "legal_rejected")

# The BD funnel: each step is "this timestamp is set".
_BD_STEPS: tuple[tuple[str, str, Any], ...] = (
    ("drafted", "Drafted", S.draft_submitted_at),
    ("shortlisted", "Shortlisted", S.shortlisted_at),
    ("details", "Details in", S.details_submitted_at),
    ("approved", "Approved", S.approved_at),
    ("loi", "LOI uploaded", S.loi_uploaded_at),
    ("legal_review", "Legal review", S.legal_review_at),
    ("legal_approved", "Legal cleared", S.legal_approved_at),
    ("payments", "Payments", S.pushed_to_payments_at),
    ("launched", "Launched", S.launched_at),
)

# Modules a supervisor can belong to (user_module_memberships CHECK).
_MODULES = ("bd", "legal", "design", "project", "nso", "project_excellence")

# Stage order per module, for the module funnel.
_MODULE_STAGES: dict[str, tuple[str, ...]] = {
    "legal": ("pending", "in_review", "positive", "negative"),
    "design": ("recce", "2d", "3d", "boq", "gfc", "done"),
    "project": ("pending", "allocated", "budgeting", "in_progress", "done"),
    "nso": ("stage_one", "stage_two", "stage_three", "final", "done"),
    "project_excellence": ("pending", "allocated", "budgeting", "approved"),
}

_STAGE_LABELS = {
    "pending": "Pending", "in_review": "In review", "positive": "DD positive", "negative": "DD negative",
    "recce": "Recce", "2d": "2D", "3d": "3D", "boq": "BOQ", "gfc": "GFC", "done": "Done",
    "allocated": "Allocated", "budgeting": "Budgeting", "in_progress": "In progress",
    "stage_one": "Stage 1", "stage_two": "Stage 2", "stage_three": "Stage 3", "final": "Final",
    "approved": "Approved",
}

_ACTIVITY_DAYS = 84
_TOP_N = 12


# ── Caller context ───────────────────────────────────────────────────────────

@dataclass(frozen=True)
class DashContext:
    """Who is asking and which slice of the tenant they may see."""

    tenant_id: str
    user_id: str
    kind: str                      # "admin" | "supervisor" | "executive"
    module: Optional[str]
    scope: str = "module"          # "module" | "team" (supervisors only)
    simulated: bool = False
    team_ids: tuple[str, ...] = field(default_factory=tuple)

    @property
    def is_bd(self) -> bool:
        """True when the caller works in BD (or is tenant-wide)."""
        return self.kind == "admin" or self.module == "bd"


def resolve_context(user: dict, scope: str) -> DashContext:
    """Map the authenticated claims to a dashboard context.

    Raises 403 for roles without a dashboard (vendors) and for a supervisor or
    executive with no recognised module.
    """
    role = (user.get("role") or "").lower()
    real_role = (user.get("real_role") or role).lower()
    module = user.get("module")
    base = {"tenant_id": str(user["tenant_id"]), "user_id": str(user["sub"]), "module": module}

    if role in READ_ALL_ROLES:
        return DashContext(kind="admin", **base)
    if role not in (Role.SUPERVISOR.value, Role.EXECUTIVE.value) or module not in _MODULES:
        raise HTTPException(http_status.HTTP_403_FORBIDDEN, "No dashboard for this account")
    if role == Role.EXECUTIVE.value and real_role in READ_ALL_ROLES:
        # Simulation: show the module, not the admin's (empty) personal view.
        return DashContext(kind="supervisor", simulated=True, **base)
    if role == Role.SUPERVISOR.value:
        simulated = real_role in READ_ALL_ROLES
        team_scope = "team" if scope == "team" and not simulated else "module"
        return DashContext(kind="supervisor", scope=team_scope, simulated=simulated, **base)
    return DashContext(kind="executive", **base)


_TEAM_SQL = text("""
    SELECT DISTINCT m.user_id::text AS uid
      FROM user_module_memberships m
     WHERE m.tenant_id = :tid
       AND m.module = :mod
       AND m.supervisor_id = :uid
    UNION
    SELECT DISTINCT g.executive_id::text AS uid
      FROM executive_module_access_grants g
     WHERE g.tenant_id = :tid
       AND g.module = :mod
       AND g.status = 'approved'
       AND g.target_supervisor_id = :uid
""")


async def load_team(db: AsyncSession, ctx: DashContext) -> DashContext:
    """Fill ``team_ids`` for a supervisor's "My team" scope."""
    if ctx.kind != "supervisor" or ctx.scope != "team":
        return ctx
    rows = (await db.execute(_TEAM_SQL, {"tid": ctx.tenant_id, "mod": ctx.module, "uid": ctx.user_id})).all()
    team = tuple(sorted({r[0] for r in rows if r[0] and r[0] != ctx.user_id}))
    return DashContext(**{**ctx.__dict__, "team_ids": team})


# ── Site scope (SQLAlchemy Core, never string-built) ─────────────────────────

def _delegation_modules(module: str) -> list[str]:
    companion = _COMPANION_DELEGATION_MODULE.get(module)
    return [module, companion] if companion else [module]


def _module_entry(module: str):
    """A site has reached this module."""
    if module == "bd":
        return true()
    if module == "legal":
        return S.legal_review_at.isnot(None)
    if module == "design":
        r = aliased(models.DesignReview)
        return exists().where(r.site_id == S.id, r.tenant_id == S.tenant_id)
    if module == "project":
        r = aliased(models.ProjectReview)
        return exists().where(r.site_id == S.id, r.tenant_id == S.tenant_id)
    if module == "nso":
        r = aliased(models.NsoReview)
        return exists().where(r.site_id == S.id, r.tenant_id == S.tenant_id)
    return S.project_excellence_status != "pending"


def _module_awaiting(module: str):
    """A site in this module is still waiting on its supervisor."""
    if module == "bd":
        return S.status.in_(("draft_submitted", "details_submitted", "loi_uploaded"))
    if module == "legal":
        return S.status == "legal_review"
    if module == "design":
        return or_(S.design_status.is_(None), S.design_status != "approved")
    if module == "project":
        return S.project_status != "done"
    if module == "nso":
        r = aliased(models.NsoReview)
        return exists().where(r.site_id == S.id, r.tenant_id == S.tenant_id, r.current_stage != "done")
    return S.project_excellence_status != "approved"


def _delegated(ctx: DashContext, who):
    """EXISTS an active delegation of this site, in the caller's module or its
    companion, matching ``who(d)``. Aliased so a query that itself joins
    site_delegations cannot auto-correlate the subquery away."""
    d = aliased(models.SiteDelegation)
    return exists().where(
        d.site_id == S.id,
        d.tenant_id == ctx.tenant_id,
        d.revoked_at.is_(None),
        d.module.in_(_delegation_modules(ctx.module or "")),
        who(d),
    )


def site_filters(ctx: DashContext) -> list:
    """WHERE clauses limiting ``sites`` to what this caller may see."""
    clauses = [S.tenant_id == ctx.tenant_id]
    if ctx.kind == "admin":
        return clauses
    module = ctx.module or ""
    if ctx.kind == "executive":
        if module == "bd":
            clauses.append(or_(S.submitted_by == ctx.user_id, S.assigned_to == ctx.user_id))
        else:
            clauses.append(_delegated(ctx, lambda d: d.delegate_user_id == ctx.user_id))
        return clauses
    clauses.append(_module_entry(module))
    if ctx.scope == "team":
        members = [ctx.user_id, *ctx.team_ids]
        if module == "bd":
            clauses.append(or_(S.submitted_by.in_(members), S.supervisor_id == ctx.user_id))
        else:
            clauses.append(_delegated(
                ctx, lambda d: or_(d.granted_by == ctx.user_id, d.delegate_user_id.in_(members)),
            ))
    return clauses


def _scoped_ids(ctx: DashContext):
    return select(S.id).where(*site_filters(ctx))


# ── Sections ─────────────────────────────────────────────────────────────────

def _src(*cols: str) -> list[str]:
    return list(cols)


async def _kpis(db: AsyncSession, ctx: DashContext) -> dict:
    open_ = and_(S.status.notin_(_CLOSED), S.is_launched.is_(False))
    awaiting = _module_awaiting(ctx.module or "bd") if ctx.kind != "admin" else S.status == "details_submitted"
    stmt = select(
        func.count().label("total"),
        func.count().filter(open_).label("open"),
        func.count().filter(S.is_launched.is_(True)).label("launched"),
        func.count().filter(S.status.in_(_CLOSED)).label("closed"),
        func.count().filter(and_(open_, awaiting)).label("awaiting"),
        func.count().filter(S.updated_at >= func.now() - text("interval '7 days'")).label("moved_7d"),
    ).where(*site_filters(ctx))
    r = (await db.execute(stmt)).mappings().first() or {}
    get = lambda k: int(r.get(k) or 0)  # noqa: E731
    if ctx.kind == "executive":
        tiles = [
            {"key": "mine", "label": "My sites", "value": get("total")},
            {"key": "open", "label": "In progress", "value": get("open")},
            {"key": "moved", "label": "Moved this week", "value": get("moved_7d")},
            {"key": "done", "label": "Launched", "value": get("launched")},
        ]
    elif ctx.kind == "supervisor":
        tiles = [
            {"key": "in_module", "label": "In module", "value": get("total")},
            {"key": "awaiting", "label": "Waiting on you", "value": get("awaiting")},
            {"key": "open", "label": "In progress", "value": get("open")},
            {"key": "team", "label": "Team members", "value": len(ctx.team_ids)} if ctx.scope == "team"
            else {"key": "launched", "label": "Launched", "value": get("launched")},
        ]
    else:
        tiles = [
            {"key": "total", "label": "Total sites", "value": get("total")},
            {"key": "awaiting", "label": "Awaiting approval", "value": get("awaiting")},
            {"key": "launched", "label": "Completed sites", "value": get("launched")},
            {"key": "open", "label": "In progress", "value": get("open")},
        ]
    return {"tiles": tiles, "closed": get("closed"), "source": _src("sites.status", "sites.is_launched", "sites.updated_at")}


async def _bd_funnel(db: AsyncSession, ctx: DashContext) -> dict:
    cols = [func.count().filter(col.isnot(None)).label(key) for key, _label, col in _BD_STEPS]
    r = (await db.execute(select(*cols).where(*site_filters(ctx)))).mappings().first() or {}
    steps = [{"key": k, "label": lbl, "count": int(r.get(k) or 0)} for k, lbl, _c in _BD_STEPS]
    return {"steps": steps, "source": _src("sites.*_at")}


def _stage_column(module: str):
    """(column, extra join target) holding a module site's current stage."""
    if module == "legal":
        return S.legal_dd_status, None
    if module == "design":
        return models.DesignReview.current_stage, models.DesignReview
    if module == "nso":
        return models.NsoReview.current_stage, models.NsoReview
    if module == "project":
        return S.project_status, None
    return S.project_excellence_status, None


async def _module_funnel(db: AsyncSession, ctx: DashContext) -> dict:
    module = ctx.module or ""
    col, joined = _stage_column(module)
    stmt = select(col.label("stage"), func.count().label("n")).select_from(S)
    if joined is not None:
        stmt = stmt.join(joined, and_(joined.site_id == S.id, joined.tenant_id == S.tenant_id))
    stmt = stmt.where(*site_filters(ctx)).group_by(col)
    counts = {row[0]: int(row[1]) for row in (await db.execute(stmt)).all()}
    order = _MODULE_STAGES.get(module, ())
    keys = list(order) + sorted(k for k in counts if k and k not in order)
    steps = [{"key": k, "label": _STAGE_LABELS.get(k, k.replace("_", " ").title()), "count": counts.get(k, 0)} for k in keys]
    return {"steps": steps, "module": module, "source": _src(f"{module} current stage")}


_MODULE_STATUS_COLUMNS: tuple[tuple[str, str, Any], ...] = (
    ("legal", "Legal DD", S.legal_dd_status),
    ("design", "Design", S.design_status),
    ("project", "Project", S.project_status),
    ("project_excellence", "Project excellence", S.project_excellence_status),
    ("financial_closure", "Financial closure", S.financial_closure_status),
    ("finance", "Finance", S.finance_status),
)


async def _modules(db: AsyncSession, ctx: DashContext) -> dict:
    """Status breakdown per module mirror column on ``sites``."""
    wanted = _MODULE_STATUS_COLUMNS if ctx.kind == "admin" else tuple(
        m for m in _MODULE_STATUS_COLUMNS if m[0] == ctx.module
    )
    if not wanted:
        return {}
    parts = [
        select(literal(key).label("module"), col.label("status"), func.count().label("n"))
        .where(*site_filters(ctx), S.status.notin_(_CLOSED))
        .group_by(col)
        for key, _label, col in wanted
    ]
    stmt = parts[0] if len(parts) == 1 else parts[0].union_all(*parts[1:])
    grouped: dict[str, list[dict]] = {key: [] for key, _l, _c in wanted}
    for module, status, n in (await db.execute(stmt)).all():
        grouped.setdefault(module, []).append({"status": status or "pending", "count": int(n)})
    items = [
        {"key": key, "label": label, "statuses": sorted(grouped.get(key, []), key=lambda x: -x["count"])}
        for key, label, _c in wanted
    ]
    return {"items": items, "source": _src(*(f"sites.{c.key}" for _k, _l, c in wanted))}


async def _cycle_times(db: AsyncSession, ctx: DashContext) -> dict:
    """Median days between consecutive BD steps."""
    pairs = list(zip(_BD_STEPS, _BD_STEPS[1:]))
    cols = []
    for (k1, _l1, a), (k2, _l2, b) in pairs:
        days = func.extract("epoch", b - a) / 86400.0
        cols.append(func.percentile_cont(0.5).within_group(days).filter(and_(a.isnot(None), b.isnot(None), b >= a)).label(f"{k1}__{k2}"))
    r = (await db.execute(select(*cols).where(*site_filters(ctx)))).mappings().first() or {}
    steps = []
    for (k1, l1, _a), (k2, l2, _b) in pairs:
        v = r.get(f"{k1}__{k2}")
        steps.append({"from": k1, "to": k2, "label": f"{l1} → {l2}", "median_days": round(float(v), 1) if v is not None else None})
    return {"steps": steps, "source": _src("sites.*_at")}


async def _cities(db: AsyncSession, ctx: DashContext) -> dict:
    rent_psf = case((S.area_sqft > 0, S.expected_rent / S.area_sqft), else_=None)
    stmt = (
        select(
            S.city,
            func.count().label("sites"),
            func.count().filter(S.is_launched.is_(True)).label("launched"),
            func.count().filter(and_(S.status.notin_(_CLOSED), S.is_launched.is_(False))).label("pipeline"),
            func.avg(rent_psf).label("rent_psf"),
        )
        .where(*site_filters(ctx))
        .group_by(S.city)
        .order_by(func.count().desc(), S.city)
        .limit(_TOP_N)
    )
    items = [
        {"city": c, "sites": int(n), "launched": int(lc), "pipeline": int(p),
         "rent_psf": round(float(r), 1) if r is not None else None}
        for c, n, lc, p, r in (await db.execute(stmt)).all()
    ]
    return {"items": items, "source": _src("sites.city", "sites.expected_rent", "sites.area_sqft")}


async def _launches(db: AsyncSession, ctx: DashContext) -> dict:
    """Openings per month (last 12) and planned openings from NSO launch dates."""
    month = func.date_trunc("month", S.launched_at)
    opened = (
        select(month.label("m"), func.count())
        .where(*site_filters(ctx), S.launched_at.isnot(None), S.launched_at >= func.now() - text("interval '12 months'"))
        .group_by(month).order_by(month)
    )
    n = models.NsoReview
    planned = (
        select(S.id, S.name, S.city, n.launch_date)
        .join(n, and_(n.site_id == S.id, n.tenant_id == S.tenant_id))
        .where(*site_filters(ctx), S.is_launched.is_(False), n.launch_date.isnot(None), n.launch_date >= func.current_date())
        .order_by(n.launch_date).limit(8)
    )
    by_month = [{"month": m.date().isoformat() if hasattr(m, "date") else str(m), "opened": int(c)} for m, c in (await db.execute(opened)).all()]
    upcoming = [
        {"site_id": str(i), "name": nm, "city": c, "launch_date": d.isoformat() if isinstance(d, date) else str(d)}
        for i, nm, c, d in (await db.execute(planned)).all()
    ]
    return {"by_month": by_month, "upcoming": upcoming, "source": _src("sites.launched_at", "nso_reviews.launch_date")}


async def _compliance(db: AsyncSession, ctx: DashContext) -> dict:
    """LOIs overdue or due within 7 days, DD negatives, legal rejections."""
    a = models.Approval
    deadline = (
        select(func.max(a.loi_deadline))
        .where(a.site_id == S.id, a.tenant_id == S.tenant_id, a.status == "approved")
        .correlate(S).scalar_subquery()
    )
    today = func.current_date()
    stmt = select(
        func.count().filter(and_(S.status == "approved", deadline < today)).label("loi_overdue"),
        func.count().filter(and_(S.status == "approved", deadline >= today, deadline <= today + 7)).label("loi_due_7d"),
        func.count().filter(S.legal_dd_status == "negative").label("dd_negative"),
        func.count().filter(S.status == "legal_rejected").label("legal_rejected"),
    ).where(*site_filters(ctx))
    r = (await db.execute(stmt)).mappings().first() or {}
    out = {k: int(r.get(k) or 0) for k in ("loi_overdue", "loi_due_7d", "dd_negative", "legal_rejected")}
    rows = (
        select(S.id, S.name, S.city, deadline.label("deadline"))
        .where(*site_filters(ctx), S.status == "approved", deadline.isnot(None), deadline <= today + 7)
        .order_by(deadline).limit(6)
    )
    out["loi_items"] = [
        {"site_id": str(i), "name": nm, "city": c, "deadline": d.isoformat() if isinstance(d, date) else str(d)}
        for i, nm, c, d in (await db.execute(rows)).all()
    ]
    out["source"] = _src("approvals.loi_deadline", "sites.legal_dd_status", "sites.status")
    return out


async def _activity(db: AsyncSession, ctx: DashContext) -> dict:
    al = models.AuditLog
    day = func.date_trunc("day", al.created_at)
    stmt = select(day.label("d"), func.count()).where(
        al.tenant_id == ctx.tenant_id,
        al.created_at >= func.now() - text("interval '84 days'"),
    )
    if ctx.kind == "executive":
        stmt = stmt.where(al.actor_id == ctx.user_id)
    elif ctx.kind == "supervisor":
        stmt = stmt.where(al.site_id.in_(_scoped_ids(ctx)))
    stmt = stmt.group_by(day).order_by(day)
    days = [{"date": d.date().isoformat() if hasattr(d, "date") else str(d), "count": int(c)} for d, c in (await db.execute(stmt)).all()]
    return {"days": days, "window_days": _ACTIVITY_DAYS, "source": _src("audit_logs.created_at")}


_ADMIN_INBOX_SQL = text("""
    SELECT 'supervisor_signups' AS key, count(*) AS n, min(created_at) AS oldest
      FROM users WHERE tenant_id = :tid AND role = 'supervisor' AND is_active = false
    UNION ALL
    SELECT 'executive_requests', count(*), min(created_at)
      FROM supervisor_executive_requests WHERE tenant_id = :tid AND status = 'pending'
    UNION ALL
    SELECT 'module_access', count(*), min(created_at)
      FROM supervisor_module_access_grants WHERE tenant_id = :tid AND status = 'pending'
    UNION ALL
    SELECT 'executive_module_access', count(*), min(created_at)
      FROM executive_module_access_grants WHERE tenant_id = :tid AND status = 'pending'
    UNION ALL
    SELECT 'finance', count(*), min(updated_at)
      FROM sites WHERE tenant_id = :tid AND finance_status = 'awaiting_admin'
    UNION ALL
    SELECT 'launch_review', count(*), min(updated_at)
      FROM launch_approvals WHERE tenant_id = :tid AND status = 'pending_admin_review'
    UNION ALL
    SELECT 'launch_final', count(*), min(updated_at)
      FROM launch_approvals WHERE tenant_id = :tid AND status = 'pending_admin_final'
    UNION ALL
    SELECT 'quality_audit', count(*), min(quality_audit_supervisor_approved_at)
      FROM project_reviews WHERE tenant_id = :tid AND quality_audit_status = 'supervisor_approved'
    UNION ALL
    SELECT 'budgets', count(*), min(updated_at)
      FROM site_budgets WHERE tenant_id = :tid AND status = 'pending_admin'
""")

_INBOX_LABELS = {
    "supervisor_signups": "Supervisor sign-ups",
    "executive_requests": "Executive access requests",
    "module_access": "Module access requests",
    "executive_module_access": "Executive module access",
    "finance": "Finance approvals",
    "launch_review": "Launch reviews",
    "launch_final": "Launch final sign-off",
    "quality_audit": "Quality audits",
    "budgets": "Budget approvals",
}


def _age_days(ts: Any, now: datetime) -> Optional[int]:
    if not isinstance(ts, datetime):
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return max(0, (now - ts).days)


async def _admin_inbox(db: AsyncSession, ctx: DashContext) -> dict:
    now = datetime.now(timezone.utc)
    queues = [
        {"key": k, "label": _INBOX_LABELS.get(k, k), "count": int(n or 0), "oldest_days": _age_days(o, now)}
        for k, n, o in (await db.execute(_ADMIN_INBOX_SQL, {"tid": ctx.tenant_id})).all()
    ]
    return {"queues": queues, "total": sum(q["count"] for q in queues), "source": _src("admin queues")}


async def _supervisor_inbox(db: AsyncSession, ctx: DashContext) -> dict:
    """Sites waiting on this supervisor, oldest first."""
    awaiting = and_(_module_awaiting(ctx.module or ""), S.status.notin_(_CLOSED))
    total = (await db.execute(select(func.count()).where(*site_filters(ctx), awaiting))).scalar() or 0
    rows = (
        select(S.id, S.name, S.city, S.status, S.updated_at)
        .where(*site_filters(ctx), awaiting).order_by(S.updated_at.asc()).limit(6)
    )
    now = datetime.now(timezone.utc)
    items = [
        {"site_id": str(i), "name": nm, "city": c, "status": st, "waiting_days": _age_days(u, now)}
        for i, nm, c, st, u in (await db.execute(rows)).all()
    ]
    return {"total": int(total), "items": items, "source": _src("sites.status", "sites.updated_at")}


async def _executive_inbox(db: AsyncSession, ctx: DashContext) -> dict:
    """The executive's own pending items: change requests they raised."""
    cr = models.LegalChangeRequest
    pending_crs = (await db.execute(
        select(func.count()).where(cr.tenant_id == ctx.tenant_id, cr.requested_by == ctx.user_id, cr.status == "pending")
    )).scalar() or 0
    return {"change_requests_pending": int(pending_crs), "source": _src("legal_change_requests.status")}


_PEOPLE_SQL = text("""
    SELECT role, count(*) FILTER (WHERE is_active) AS active, count(*) FILTER (WHERE NOT is_active) AS inactive
      FROM users
     WHERE tenant_id = :tid
     GROUP BY role
""")


async def _people(db: AsyncSession, ctx: DashContext) -> dict:
    rows = (await db.execute(_PEOPLE_SQL, {"tid": ctx.tenant_id})).all()
    return {
        "roles": [{"role": r, "active": int(a or 0), "inactive": int(i or 0)} for r, a, i in rows],
        "source": _src("users.role", "users.is_active"),
    }


async def _workload(db: AsyncSession, ctx: DashContext) -> dict:
    """Open sites per person (BD: submitter or assignee; elsewhere: active delegations)."""
    u = models.User
    if ctx.is_bd:
        owner = func.coalesce(S.assigned_to, S.submitted_by)
        stmt = (
            select(u.id, u.name, func.count().label("n"))
            .select_from(S).join(u, u.id == owner)
            .where(*site_filters(ctx), S.status.notin_(_CLOSED), S.is_launched.is_(False))
        )
        if ctx.scope == "team":
            stmt = stmt.where(owner.in_([ctx.user_id, *ctx.team_ids]))
    else:
        d = models.SiteDelegation
        stmt = (
            select(u.id, u.name, func.count(func.distinct(d.site_id)).label("n"))
            .select_from(d).join(u, u.id == d.delegate_user_id).join(S, S.id == d.site_id)
            .where(*site_filters(ctx), d.tenant_id == ctx.tenant_id, d.revoked_at.is_(None),
                   d.module.in_(_delegation_modules(ctx.module or "")))
        )
    stmt = stmt.group_by(u.id, u.name).order_by(text("n DESC")).limit(_TOP_N)
    items = [{"user_id": str(i), "name": nm, "open_sites": int(n)} for i, nm, n in (await db.execute(stmt)).all()]
    return {"items": items, "source": _src("sites.assigned_to", "site_delegations")}


async def _money(db: AsyncSession, ctx: DashContext) -> dict:
    open_ = S.status.notin_(_CLOSED)
    r = (await db.execute(select(
        func.coalesce(func.sum(S.expected_rent).filter(S.is_launched.is_(True)), 0).label("rent_live"),
        func.coalesce(func.sum(S.expected_rent).filter(and_(open_, S.is_launched.is_(False))), 0).label("rent_pipeline"),
        func.coalesce(func.sum(S.finance_amount).filter(S.finance_status == "approved"), 0).label("finance_approved"),
        func.coalesce(func.sum(S.finance_amount).filter(S.finance_status.in_(("awaiting_supervisor", "awaiting_admin"))), 0).label("finance_pending"),
    ).where(*site_filters(ctx)))).mappings().first() or {}
    b = models.SiteBudget
    budgets = (await db.execute(
        select(b.phase, func.coalesce(func.sum(b.budget_total), 0), func.count())
        .where(b.tenant_id == ctx.tenant_id).group_by(b.phase)
    )).all()
    return {
        **{k: float(r.get(k) or 0) for k in ("rent_live", "rent_pipeline", "finance_approved", "finance_pending")},
        "budgets": [{"phase": p, "total": float(t or 0), "sites": int(n)} for p, t, n in budgets],
        "source": _src("sites.expected_rent", "sites.finance_amount", "site_budgets.budget_total"),
    }


# ── Builders ─────────────────────────────────────────────────────────────────

async def _admin_payload(db: AsyncSession, ctx: DashContext) -> dict:
    return {
        "kpis": await _kpis(db, ctx),
        "inbox": await _admin_inbox(db, ctx),
        "launches": await _launches(db, ctx),
        "funnel": await _bd_funnel(db, ctx),
        "modules": await _modules(db, ctx),
        "cycle_times": await _cycle_times(db, ctx),
        "cities": await _cities(db, ctx),
        "compliance": await _compliance(db, ctx),
        "money": await _money(db, ctx),
        "people": await _people(db, ctx),
        "workload": await _workload(db, ctx),
        "activity": await _activity(db, ctx),
    }


async def _supervisor_payload(db: AsyncSession, ctx: DashContext) -> dict:
    out: dict[str, Any] = {
        "kpis": await _kpis(db, ctx),
        "inbox": await _supervisor_inbox(db, ctx),
        "funnel": await (_bd_funnel(db, ctx) if ctx.is_bd else _module_funnel(db, ctx)),
    }
    modules = await _modules(db, ctx)
    if modules:
        out["modules"] = modules
    if ctx.is_bd:
        out["cycle_times"] = await _cycle_times(db, ctx)
    out["cities"] = await _cities(db, ctx)
    if ctx.module in ("bd", "legal"):
        out["compliance"] = await _compliance(db, ctx)
    if ctx.module == "nso":
        out["launches"] = await _launches(db, ctx)
    out["workload"] = await _workload(db, ctx)
    out["activity"] = await _activity(db, ctx)
    return out


async def _executive_payload(db: AsyncSession, ctx: DashContext) -> dict:
    out: dict[str, Any] = {
        "kpis": await _kpis(db, ctx),
        "inbox": await _executive_inbox(db, ctx),
        "funnel": await (_bd_funnel(db, ctx) if ctx.is_bd else _module_funnel(db, ctx)),
        "cities": await _cities(db, ctx),
    }
    if ctx.is_bd:
        out["compliance"] = await _compliance(db, ctx)
    out["activity"] = await _activity(db, ctx)
    return out


async def build_summary(db: AsyncSession, user: dict, scope: str = "module") -> dict:
    """The dashboard payload for this caller. See the module docstring."""
    ctx = await load_team(db, resolve_context(user, scope))
    if ctx.kind == "admin":
        sections = await _admin_payload(db, ctx)
    elif ctx.kind == "supervisor":
        sections = await _supervisor_payload(db, ctx)
    else:
        sections = await _executive_payload(db, ctx)
    as_of = datetime.now(timezone.utc).isoformat()
    for section in sections.values():
        section.setdefault("as_of", as_of)
    return {
        "role": ctx.kind,
        "module": ctx.module if ctx.kind != "admin" else None,
        "scope": ctx.scope if ctx.kind == "supervisor" else ("tenant" if ctx.kind == "admin" else "personal"),
        "simulated": ctx.simulated,
        "generated_at": as_of,
        **sections,
    }


# ── Change detector ──────────────────────────────────────────────────────────

_VERSION_SQL = text("""
    SELECT
      (SELECT max(created_at) FROM audit_logs WHERE tenant_id = :tid) AS audit_at,
      (SELECT count(*) FROM sites WHERE tenant_id = :tid) AS site_count,
      (SELECT max(updated_at) FROM sites WHERE tenant_id = :tid) AS sites_at,
      (SELECT max(updated_at) FROM design_reviews WHERE tenant_id = :tid) AS design_at,
      (SELECT max(updated_at) FROM project_reviews WHERE tenant_id = :tid) AS project_at,
      (SELECT max(updated_at) FROM nso_reviews WHERE tenant_id = :tid) AS nso_at,
      (SELECT max(updated_at) FROM site_budgets WHERE tenant_id = :tid) AS budgets_at,
      (SELECT max(updated_at) FROM launch_approvals WHERE tenant_id = :tid) AS launch_at,
      (SELECT count(*) FROM users WHERE tenant_id = :tid AND is_active) AS active_users
""")


async def get_version(db: AsyncSession, tenant_id: str) -> str:
    """A short hash that changes whenever anything a dashboard shows changes.

    Reveals no data, only "something changed", so any signed-in role may ask.
    """
    row = (await db.execute(_VERSION_SQL, {"tid": tenant_id})).first()
    material = "|".join("" if v is None else str(v) for v in (row or ()))
    return hashlib.sha256(f"{tenant_id}|{material}".encode()).hexdigest()[:16]


def version_etag(version: str) -> str:
    """Strong ETag for a version string."""
    return f'"{version}"'


def etag_matches(if_none_match: Optional[str], version: str) -> bool:
    """True when the client's If-None-Match already names this version."""
    if not if_none_match:
        return False
    tags = {t.strip().removeprefix("W/") for t in if_none_match.split(",")}
    return "*" in tags or version_etag(version) in tags


__all__ = [
    "DashContext", "build_nso_summary", "build_summary", "etag_matches", "get_version", "load_team",
    "resolve_context", "site_filters", "version_etag",
]



async def build_nso_summary(db: AsyncSession, user: dict) -> dict:
    """The NSO supervisor summary, served from ``/api/nso/summary``.

    An executive with NSO supervisor access is a supervisor only on ``/api/nso/*``
    (``deps._apply_borrowed_module``), so this view lives on that router and is
    always the supervisor-shaped NSO module view, whoever reaches it.
    """
    real_role = (user.get("real_role") or user.get("role") or "").lower()
    ctx = DashContext(
        tenant_id=str(user["tenant_id"]), user_id=str(user["sub"]), kind="supervisor",
        module="nso", simulated=real_role in READ_ALL_ROLES,
    )
    sections = await _supervisor_payload(db, ctx)
    as_of = datetime.now(timezone.utc).isoformat()
    for section in sections.values():
        section.setdefault("as_of", as_of)
    return {"role": "supervisor", "module": "nso", "scope": "module", "simulated": ctx.simulated,
            "generated_at": as_of, **sections}
