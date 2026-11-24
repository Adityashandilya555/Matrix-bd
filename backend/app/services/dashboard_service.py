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

import dataclasses
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
    "design": ("recce", "2d", "3d", "gfc", "done"),  # BOQ is no longer produced
    "project": ("pending", "allocated", "in_progress", "done"),  # project_service never sets budgeting
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
    tenant_id, user_id = str(user["tenant_id"]), str(user["sub"])

    if role in READ_ALL_ROLES:
        return DashContext(tenant_id=tenant_id, user_id=user_id, kind="admin", module=module)
    if role not in (Role.SUPERVISOR.value, Role.EXECUTIVE.value) or module not in _MODULES:
        raise HTTPException(http_status.HTTP_403_FORBIDDEN, "No dashboard for this account")
    if role == Role.EXECUTIVE.value and real_role in READ_ALL_ROLES:
        # Simulation: show the module, not the admin's (empty) personal view.
        return DashContext(tenant_id=tenant_id, user_id=user_id, kind="supervisor", module=module, simulated=True)
    if role == Role.SUPERVISOR.value:
        simulated = real_role in READ_ALL_ROLES
        team_scope = "team" if scope == "team" and not simulated else "module"
        return DashContext(tenant_id=tenant_id, user_id=user_id, kind="supervisor", module=module,
                           scope=team_scope, simulated=simulated)
    return DashContext(tenant_id=tenant_id, user_id=user_id, kind="executive", module=module)


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
    return dataclasses.replace(ctx, team_ids=team)


# ── Site scope (SQLAlchemy Core, never string-built) ─────────────────────────

def _delegation_modules(module: str) -> list[str]:
    companion = _COMPANION_DELEGATION_MODULE.get(module)
    return [module, companion] if companion else [module]


def _rel(model, *conds_fn):
    """EXISTS a row of ``model`` for this site matching ``conds_fn(alias)``.

    Aliased so a query that itself joins ``model`` cannot auto-correlate the
    subquery away. Some module tables (legal_dd_checklist, site_licensing) have
    no tenant_id; they are reached through the tenant-filtered site.
    """
    a = aliased(model)
    conds = [c for fn in conds_fn for c in fn(a)]
    return exists().where(a.site_id == S.id, *conds)


def _delegated_to(uid: Optional[str], module: str):
    """The caller holds an active delegation for this site in this module."""
    return _rel(models.SiteDelegation, lambda d: (
        d.tenant_id == S.tenant_id, d.revoked_at.is_(None), d.module == module, d.delegate_user_id == uid,
    ))


def _active_delegation(module: str):
    return _rel(models.SiteDelegation, lambda d: (d.tenant_id == S.tenant_id, d.revoked_at.is_(None), d.module == module))


def _budget(phase: str, *statuses: str):
    return _rel(models.SiteBudget, lambda b: (b.tenant_id == S.tenant_id, b.phase == phase, b.status.in_(statuses)))


def _project(*conds_fn):
    return _rel(models.ProjectReview, lambda r: (r.tenant_id == S.tenant_id,), *conds_fn)


def _nso(*conds_fn):
    return _rel(models.NsoReview, lambda r: (r.tenant_id == S.tenant_id,), *conds_fn)


def _deliverable(*statuses: str):
    return _rel(models.DesignDeliverable, lambda d: (d.tenant_id == S.tenant_id, d.status.in_(statuses)))


def _module_entry(module: str):
    """A site is in this module's queue (including not-yet-allocated sites)."""
    if module == "bd":
        return true()
    if module == "legal":
        return S.legal_review_at.isnot(None)
    if module == "design":
        return and_(S.legal_dd_status == "positive", S.finance_status == "approved")
    if module in ("project", "project_excellence"):
        return S.design_status == "approved"
    # nso
    return and_(S.finance_status == "approved", S.ca_code.isnot(None))


def _module_open(module: str):
    """Work in this module is not finished for the site."""
    if module == "bd":
        return and_(S.status.notin_(_CLOSED), S.is_launched.is_(False))
    if module == "legal":
        return S.status == "legal_review"
    if module == "design":
        return or_(S.design_status.is_(None), S.design_status != "approved")
    if module == "project":
        return S.project_status != "done"
    if module == "project_excellence":
        return S.project_excellence_status != "approved"
    return and_(S.is_launched.is_(False), ~_nso(lambda r: (r.current_stage == "done",)))


# Hero tiles per (module, role): (key, label, caption, predicate, needs_action).
# needs_action marks the tiles that make up "Waiting on you" for that role, so
# the inbox and the tiles always agree. Definitions follow each module's
# service: who moves the site next, not merely "unfinished". One small
# function per (module, role), chosen from _TILE_BUILDERS; every builder takes
# (today, uid), and ones that need neither name them with a leading underscore.
TileDef = tuple[str, str, str, Any, bool]

def _tiles_bd_sup(_today, _uid: Optional[str]) -> list[TileDef]:
    return [
        ("shortlist", "To shortlist", "new drafts", S.status == "draft_submitted", True),
        ("approve", "To approve", "details submitted", S.status == "details_submitted", True),
        ("push", "To push to legal", "LOI uploaded", S.status == "loi_uploaded", True),
        ("loi_back", "LOIs sent back", "waiting on the executive",
         and_(S.status == "approved", S.loi_rejection_note.isnot(None)), False),
    ]


def _tiles_bd_exec(today, uid: Optional[str]) -> list[TileDef]:
    deadline = (
        select(func.max(models.Approval.loi_deadline))
        .where(models.Approval.site_id == S.id, models.Approval.tenant_id == S.tenant_id, models.Approval.status == "approved")
        .correlate(S).scalar_subquery()
    )
    return [
        ("details", "Need details", "shortlisted sites", S.status == "shortlisted", True),
        ("loi_due", "LOI due ≤ 7 days", "including overdue",
         and_(S.status == "approved", deadline <= today + 7), True),
        ("sent_back", "Sent back to me", "LOI returned by supervisor",
         and_(S.status == "approved", S.loi_rejection_note.isnot(None)), True),
        ("cr", "Change requests open", "raised by you",
         _rel(models.LegalChangeRequest,
              lambda c: (c.tenant_id == S.tenant_id, c.status == "pending", c.requested_by == uid)), False),
    ]


def _tiles_legal_sup(_today, _uid: Optional[str]) -> list[TileDef]:
    return [
        ("dd_review", "DD to review", "submitted checklists",
         _rel(models.LegalDdChecklist, lambda c: (c.stage == "pending_review",)), True),
        ("lic_review", "Licensing to review", "submitted licences",
         _rel(models.SiteLicensing, lambda c: (c.stage == "pending_review",)), True),
        ("cr", "Change requests", "waiting for a decision",
         _rel(models.LegalChangeRequest, lambda c: (c.tenant_id == S.tenant_id, c.status == "pending")), True),
        ("unallocated", "Not allocated", "no executive yet",
         and_(S.status == "legal_review", ~_active_delegation("legal")), True),
    ]


def _tiles_legal_exec(_today, _uid: Optional[str]) -> list[TileDef]:
    return [
        ("dd_draft", "DD drafts", "checklists to finish",
         _rel(models.LegalDdChecklist, lambda c: (c.stage == "draft",)), True),
        ("lic_draft", "Licensing drafts", "licences to finish",
         _rel(models.SiteLicensing, lambda c: (c.stage == "draft",)), True),
        ("submitted", "With supervisor", "submitted for review",
         or_(_rel(models.LegalDdChecklist, lambda c: (c.stage == "pending_review",)),
             _rel(models.SiteLicensing, lambda c: (c.stage == "pending_review",))), False),
        ("dd_negative", "DD negative", "on your sites", S.legal_dd_status == "negative", False),
    ]


def _tiles_design_sup(_today, _uid: Optional[str]) -> list[TileDef]:
    return [
        ("allocate", "To allocate", "ready for design", S.design_status == "pending", True),
        ("review", "Deliverables to review", "submitted by executives", _deliverable("submitted"), True),
        ("gfc", "Ready for GFC", "send to admin",
         and_(S.design_status == "in_progress",
              _rel(models.DesignReview, lambda r: (r.tenant_id == S.tenant_id, r.current_stage == "gfc"))), True),
        ("done", "Design complete", "approved", S.design_status == "approved", False),
    ]


def _tiles_design_exec(_today, _uid: Optional[str]) -> list[TileDef]:
    return [
        ("upload", "To work on", "no deliverable under review",
         and_(or_(S.design_status.is_(None), S.design_status != "approved"), ~_deliverable("submitted")), True),
        ("awaiting", "Awaiting review", "submitted", _deliverable("submitted"), False),
        ("sent_back", "Sent back", "rejected deliverables", _deliverable("rejected"), True),
        ("done", "Completed", "design approved", S.design_status == "approved", False),
    ]


def _tiles_project_sup(today, _uid: Optional[str]) -> list[TileDef]:
    return [
        ("allocate", "To allocate", "design approved",
         and_(~_active_delegation("project"), S.project_status != "done", S.is_launched.is_(False)), True),
        ("approvals", "Approvals pending", "dates and quality audits",
         _project(lambda r: (or_(r.expected_completion_status == "submitted", r.quality_audit_status == "submitted"),)), True),
        ("overdue", "Overdue", "past expected completion",
         and_(S.project_status != "done", _project(lambda r: (r.expected_completion_date < today,))), False),
        ("handover", "Ready for NSO", "done, not handed over",
         and_(S.project_status == "done", _project(lambda r: (r.nso_status == "pending",))), True),
    ]


def _tiles_project_exec(_today, uid: Optional[str]) -> list[TileDef]:
    # A financial-closure-only delegate must not get project tasks, and vice
    # versa: each tile counts the delegation module it acts on.
    project, closure = _delegated_to(uid, "project"), _delegated_to(uid, "financial_closure")
    return [
        ("init", "Start date to confirm", "proposed by supervisor",
         and_(project, _project(lambda r: (r.initialization_status == "proposed",))), True),
        ("completion", "Completion date due", "set the expected finish",
         and_(project, _project(lambda r: (r.initialization_status == "approved", r.expected_completion_status.in_(("pending", "rejected"))))), True),
        ("qa", "QA inspection due", "visit date set",
         and_(project, _project(lambda r: (r.mid_project_visit_date.isnot(None), r.quality_audit_status.in_(("pending", "rejected"))))), True),
        ("closure", "Closure budgets to fill", "financial closure", and_(closure, _budget("closure", "draft", "rejected")), True),
    ]


def _tiles_project_excellence_sup(_today, _uid: Optional[str]) -> list[TileDef]:
    return [
        ("allocate", "To allocate", "design approved", S.project_excellence_status == "pending", True),
        ("budget_review", "Budgets to review", "submitted by executives", _budget("gfc", "pending_supervisor"), True),
        ("qa", "Quality audits to confirm", "supervisor-approved",
         _project(lambda r: (r.quality_audit_status == "supervisor_approved",)), True),
        ("with_admin", "Budgets with admin", "awaiting admin", _budget("gfc", "pending_admin"), False),
    ]


def _tiles_project_excellence_exec(_today, uid: Optional[str]) -> list[TileDef]:
    pe, qa = _delegated_to(uid, "project_excellence"), _delegated_to(uid, "quality_audit")
    return [
        ("fill", "Budgets to fill", "draft or sent back", and_(pe, _budget("gfc", "draft", "rejected")), True),
        ("review", "Awaiting review", "with supervisor or admin", and_(pe, _budget("gfc", "pending_supervisor", "pending_admin")), False),
        ("qa", "Quality audits due", "pending or sent back",
         and_(qa, _project(lambda r: (r.quality_audit_status.in_(("pending", "rejected")),))), True),
        ("approved", "Budgets approved", "done", and_(pe, _budget("gfc", "approved")), False),
    ]


def _tiles_nso_sup(today, _uid: Optional[str]) -> list[TileDef]:
    return [
    ("stage1", "Stage 1 to complete", "property and comms",
     or_(and_(~_nso(lambda r: (true(),)), S.is_launched.is_(False)),
         _nso(lambda r: (r.current_stage == "stage_one",))), True),
    ("stage3", "Stage 3 to complete", "licences and handover", _nso(lambda r: (r.current_stage == "stage_three",)), True),
    ("final", "Final approval due", "ready to sign off", _nso(lambda r: (r.current_stage == "final",)), True),
    ("launching", "Launching ≤ 14 days", "by NSO launch date",
     _nso(lambda r: (r.launch_date >= today, r.launch_date <= today + 14)), False),
    ]


_TILE_BUILDERS = {
    ("bd", "supervisor"): _tiles_bd_sup,
    ("bd", "executive"): _tiles_bd_exec,
    ("legal", "supervisor"): _tiles_legal_sup,
    ("legal", "executive"): _tiles_legal_exec,
    ("design", "supervisor"): _tiles_design_sup,
    ("design", "executive"): _tiles_design_exec,
    ("project", "supervisor"): _tiles_project_sup,
    ("project", "executive"): _tiles_project_exec,
    ("project_excellence", "supervisor"): _tiles_project_excellence_sup,
    ("project_excellence", "executive"): _tiles_project_excellence_exec,
    ("nso", "supervisor"): _tiles_nso_sup,
}


def _tiles(module: str, kind: str, uid: Optional[str] = None) -> list[TileDef]:
    """The four hero tiles for this module and role."""
    builder = _TILE_BUILDERS.get((module, kind)) or _TILE_BUILDERS[("nso", "supervisor")]
    return builder(func.current_date(), uid)


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
            # Assigned as well as submitted: the same two columns that put a
            # site on an executive's own dashboard (_common.apply_role_scope).
            clauses.append(or_(
                S.submitted_by.in_(members), S.assigned_to.in_(members), S.supervisor_id == ctx.user_id,
            ))
        else:
            clauses.append(_delegated(
                ctx, lambda d: or_(d.granted_by == ctx.user_id, d.delegate_user_id.in_(members)),
            ))
    return clauses


def _scoped_ids(ctx: DashContext):
    return select(S.id).where(*site_filters(ctx))


# ── Sections ─────────────────────────────────────────────────────────────────

async def _first_row(db: AsyncSession, stmt) -> dict[str, Any]:
    """The single aggregate row of ``stmt`` as a plain dict ({} when empty)."""
    row = (await db.execute(stmt)).mappings().first()
    return dict(row) if row else {}



async def _kpis(db: AsyncSession, ctx: DashContext) -> dict:
    if ctx.kind != "admin":
        return await _role_kpis(db, ctx)
    open_ = and_(S.status.notin_(_CLOSED), S.is_launched.is_(False))
    stmt = select(
        func.count().label("total"),
        func.count().filter(open_).label("open"),
        func.count().filter(S.is_launched.is_(True)).label("launched"),
        func.count().filter(S.status.in_(_CLOSED)).label("closed"),
    ).where(*site_filters(ctx))
    r = await _first_row(db, stmt)
    get = lambda k: int(r.get(k) or 0)  # noqa: E731
    # "awaiting" is overwritten with the admin inbox total in _admin_payload.
    tiles = [
        {"key": "total", "label": "Total sites", "value": get("total"), "caption": "in the workspace"},
        {"key": "awaiting", "label": "Awaiting approval", "value": 0, "caption": "in your queues"},
        {"key": "launched", "label": "Completed sites", "value": get("launched"), "caption": "opened"},
        {"key": "open", "label": "In progress", "value": get("open"), "caption": "still moving"},
    ]
    await _admin_kpi_series(db, ctx, tiles)
    return {"tiles": tiles, "closed": get("closed"), "source": ["sites.status", "sites.is_launched"]}


_KPI_SERIES_SQL = text("""
    SELECT w.week,
           count(s.id) FILTER (WHERE s.created_at < w.week + interval '7 days') AS total,
           count(s.id) FILTER (WHERE s.launched_at < w.week + interval '7 days') AS launched,
           count(s.id) FILTER (WHERE s.created_at < w.week + interval '7 days'
                                 AND (s.launched_at IS NULL OR s.launched_at >= w.week + interval '7 days')
                                 AND (s.rejected_at IS NULL OR s.rejected_at >= w.week + interval '7 days')
                                 AND (s.archived_at IS NULL OR s.archived_at >= w.week + interval '7 days')
                                 AND NOT (s.status = 'legal_rejected'
                                          AND s.legal_rejected_at < w.week + interval '7 days')) AS open
      FROM generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') AS w(week)
      LEFT JOIN sites s ON s.tenant_id = :tid
     GROUP BY w.week
     ORDER BY w.week
""")


async def _admin_kpi_series(db: AsyncSession, ctx: DashContext, tiles: list[dict]) -> None:
    """Attach 12 weekly points and a 4-week change to the admin tiles that have
    real history (sites created, launched, still open). "Awaiting approval"
    has no history in the data, so it gets none rather than a made-up line."""
    rows = (await db.execute(_KPI_SERIES_SQL, {"tid": ctx.tenant_id})).all()
    if not rows:
        return
    cols = {"total": 1, "launched": 2, "open": 3}
    for tile in tiles:
        col = cols.get(tile["key"])
        if col is None:
            continue
        series = [int(r[col] or 0) for r in rows]
        # The tile counts by status; the history by timestamps, which older
        # rows may lack. The current week is the tile, so the two never differ.
        series[-1] = int(tile["value"])
        tile["series"] = series
        if len(series) >= 5:
            tile["delta"] = series[-1] - series[-5]


async def _role_kpis(db: AsyncSession, ctx: DashContext) -> dict:
    """The four tiles for a supervisor or executive: the module's own work."""
    defs = _tiles(ctx.module or "bd", ctx.kind, ctx.user_id)
    # Action tiles use the same closed-site filter as _action_inbox, so a tile
    # never counts work that "Waiting on you" can't show.
    stmt = select(*[
        func.count().filter(and_(pred, S.status.notin_(_CLOSED)) if action else pred).label(key)
        for key, _l, _c, pred, action in defs
    ]).where(*site_filters(ctx))
    r = await _first_row(db, stmt)
    tiles = [{"key": key, "label": label, "value": int(r.get(key) or 0), "caption": caption}
             for key, label, caption, _p, _a in defs]
    return {"tiles": tiles, "source": [f"{ctx.module} queues"]}


async def _bd_funnel(db: AsyncSession, ctx: DashContext) -> dict:
    cols = [func.count().filter(col.isnot(None)).label(key) for key, _label, col in _BD_STEPS]
    r = await _first_row(db, select(*cols).where(*site_filters(ctx)))
    steps = [{"key": k, "label": lbl, "count": int(r.get(k) or 0)} for k, lbl, _c in _BD_STEPS]
    return {"steps": steps, "source": ["sites.*_at"]}


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
    order = _MODULE_STAGES.get(module, ())
    if joined is not None:
        # Outer join: a site in the module queue without a review row yet (not
        # allocated) is at the first stage, as the "to allocate" tiles count it.
        # A finished site without one (launched before NSO capture, designed
        # before design reviews) is done, not new.
        first, last = (order[0], order[-1]) if order else ("pending", "done")
        col = func.coalesce(col, case((_module_open(module), literal(first)), else_=literal(last)))
    stmt = select(col.label("stage"), func.count().label("n")).select_from(S)
    if joined is not None:
        stmt = stmt.outerjoin(joined, and_(joined.site_id == S.id, joined.tenant_id == S.tenant_id))
    stmt = stmt.where(*site_filters(ctx))
    if ctx.kind == "executive":
        # site_filters admits companion delegations (financial closure, quality
        # audit); this funnel is the module's own stages, so only its own sites.
        stmt = stmt.where(_delegated_to(ctx.user_id, module))
    stmt = stmt.group_by(col)
    counts = {row[0]: int(row[1]) for row in (await db.execute(stmt)).all()}
    keys = list(order) + sorted(k for k in counts if k and k not in order)
    steps = [{"key": k, "label": _STAGE_LABELS.get(k, k.replace("_", " ").title()), "count": counts.get(k, 0)} for k in keys]
    return {"steps": steps, "module": module, "source": [f"{module} current stage"]}


_MODULE_STATUS_COLUMNS: tuple[tuple[str, str, Any], ...] = (
    ("legal", "Legal DD", S.legal_dd_status),
    ("design", "Design", S.design_status),
    ("project", "Project", S.project_status),
    ("project_excellence", "Project excellence", S.project_excellence_status),
    ("financial_closure", "Financial closure", S.financial_closure_status),
    ("finance", "Finance", S.finance_status),
)


def _status_entry(key: str):
    """A site has reached this module, by the same rule the module's own pages
    use. Without it every open site counted as "pending" in every module, so an
    early-pipeline site showed up as pending in Finance, Design, Project ..."""
    if key == "finance":
        # Payments lists sites from the push into legal review onwards.
        return S.legal_review_at.isnot(None)
    if key == "financial_closure":
        # svc_fc_queue: closure starts when the status leaves "pending".
        return func.coalesce(S.financial_closure_status, "pending") != "pending"
    return _module_entry(key)


def _count_of(item: dict[str, Any]) -> int:
    return int(item["count"])


async def _modules(db: AsyncSession, ctx: DashContext) -> dict:
    """Status breakdown per module mirror column on ``sites``."""
    # A project supervisor also runs financial closure; their own project_status
    # is already the funnel, so the breakdown shows closure instead.
    own = "financial_closure" if ctx.module == "project" else ctx.module
    wanted = _MODULE_STATUS_COLUMNS if ctx.kind == "admin" else tuple(
        m for m in _MODULE_STATUS_COLUMNS if m[0] == own
    )
    if not wanted:
        return {}
    parts = [
        select(literal(key).label("module"), col.label("status"), func.count().label("n"))
        .where(*site_filters(ctx), S.status.notin_(_CLOSED), _status_entry(key))
        .group_by(col)
        for key, _label, col in wanted
    ]
    stmt = parts[0] if len(parts) == 1 else parts[0].union_all(*parts[1:])
    grouped: dict[str, list[dict[str, Any]]] = {key: [] for key, _l, _c in wanted}
    for module, status, n in (await db.execute(stmt)).all():
        grouped.setdefault(module, []).append({"status": status or "pending", "count": int(n)})
    items: list[dict[str, Any]] = []
    for key, label, _c in wanted:
        statuses: list[dict[str, Any]] = sorted(grouped.get(key, []), key=_count_of, reverse=True)
        items.append({"key": key, "label": label, "statuses": statuses})
    return {"items": items, "source": [*(f"sites.{c.key}" for _k, _l, c in wanted)]}


async def _cycle_times(db: AsyncSession, ctx: DashContext) -> dict:
    """Median days between consecutive BD steps."""
    pairs = list(zip(_BD_STEPS, _BD_STEPS[1:]))
    cols = []
    for (k1, _l1, a), (k2, _l2, b) in pairs:
        days = func.extract("epoch", b - a) / 86400.0
        cols.append(func.percentile_cont(0.5).within_group(days).filter(and_(a.isnot(None), b.isnot(None), b >= a)).label(f"{k1}__{k2}"))
    r = await _first_row(db, select(*cols).where(*site_filters(ctx)))
    steps = []
    for (k1, l1, _a), (k2, l2, _b) in pairs:
        v = r.get(f"{k1}__{k2}")
        steps.append({"from": k1, "to": k2, "label": f"{l1} → {l2}", "median_days": round(float(v), 1) if v is not None else None})
    return {"steps": steps, "source": ["sites.*_at"]}


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
    return {"items": items, "source": ["sites.city", "sites.expected_rent", "sites.area_sqft"]}


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
    pmonth = func.date_trunc("month", n.launch_date)
    planned_months = (
        select(pmonth.label("m"), func.count())
        .select_from(S).join(n, and_(n.site_id == S.id, n.tenant_id == S.tenant_id))
        .where(*site_filters(ctx), S.is_launched.is_(False), n.launch_date >= func.current_date(),
               n.launch_date < func.current_date() + text("interval '4 months'"))
        .group_by(pmonth).order_by(pmonth)
    )
    by_month = [{"month": m.date().isoformat() if hasattr(m, "date") else str(m), "opened": int(c)} for m, c in (await db.execute(opened)).all()]
    # Totals per month for the chart; `upcoming` stays a short list of names.
    planned_by_month = [
        {"month": m.date().isoformat() if hasattr(m, "date") else str(m), "planned": int(c)}
        for m, c in (await db.execute(planned_months)).all()
    ]
    upcoming = [
        {"site_id": str(i), "name": nm, "city": c, "launch_date": d.isoformat() if isinstance(d, date) else str(d)}
        for i, nm, c, d in (await db.execute(planned)).all()
    ]
    return {"by_month": by_month, "planned_by_month": planned_by_month, "upcoming": upcoming,
            "source": ["sites.launched_at", "nso_reviews.launch_date"]}


async def _compliance(db: AsyncSession, ctx: DashContext) -> dict:
    """LOIs overdue or due within 7 days, DD negatives, legal rejections.

    LOIs belong to BD: a Legal supervisor gets only the DD and rejection counts.
    """
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
    r = await _first_row(db, stmt)
    out: dict[str, Any] = {k: int(r.get(k) or 0) for k in ("loi_overdue", "loi_due_7d", "dd_negative", "legal_rejected")}
    rows = (
        select(S.id, func.coalesce(S.ca_code, S.code).label("code"), S.name, S.city, deadline.label("deadline"))
        .where(*site_filters(ctx), S.status == "approved", deadline.isnot(None), deadline <= today + 7)
        .order_by(deadline).limit(6)
    )
    out["loi_items"] = [
        {"site_id": str(i), "code": code or "", "name": nm, "city": c,
         "deadline": d.isoformat() if isinstance(d, date) else str(d)}
        for i, code, nm, c, d in (await db.execute(rows)).all()
    ]
    out["source"] = ["approvals.loi_deadline", "sites.legal_dd_status", "sites.status"]
    if not ctx.is_bd:
        for key in ("loi_overdue", "loi_due_7d", "loi_items"):
            out.pop(key, None)
        out["source"] = ["sites.legal_dd_status", "sites.status"]
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
    return {"days": days, "window_days": _ACTIVITY_DAYS, "source": ["audit_logs.created_at"]}


_ADMIN_INBOX_SQL = text("""
    SELECT 'supervisor_signups' AS key, count(*) AS n, min(created_at) AS oldest
      FROM users WHERE tenant_id = :tid AND role = 'supervisor' AND is_active = false
       AND notes LIKE 'pending_module:%'
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
    return {"queues": queues, "total": sum(q["count"] for q in queues), "source": ["admin queues"]}


async def _action_inbox(db: AsyncSession, ctx: DashContext) -> dict:
    """Sites that need this supervisor or executive to act, oldest first.

    Built from the same action tiles as the hero, so "Waiting on you" and the
    tiles always agree; each row says which action it is waiting for.
    """
    actions = [(label, pred) for _k, label, _c, pred, action in _tiles(ctx.module or "bd", ctx.kind, ctx.user_id) if action]
    awaiting = and_(or_(*[p for _l, p in actions]), S.status.notin_(_CLOSED))
    reason = case(*[(p, literal(label)) for label, p in actions], else_=literal(""))
    total = (await db.execute(select(func.count()).where(*site_filters(ctx), awaiting))).scalar() or 0
    rows = (
        select(S.id, func.coalesce(S.ca_code, S.code).label("code"), S.name, S.city, reason.label("reason"), S.updated_at)
        .where(*site_filters(ctx), awaiting).order_by(S.updated_at.asc()).limit(6)
    )
    now = datetime.now(timezone.utc)
    items = [
        {"site_id": str(i), "code": code or "", "name": nm, "city": c, "reason": why, "waiting_days": _age_days(u, now)}
        for i, code, nm, c, why, u in (await db.execute(rows)).all()
    ]
    return {"total": int(total), "items": items, "source": [f"{ctx.module} queues", "sites.updated_at"]}


_PEOPLE_SQL = text("""
    SELECT role, count(*) FILTER (WHERE is_active) AS active, count(*) FILTER (WHERE NOT is_active) AS inactive,
           (SELECT seat_limit FROM tenants WHERE id = :tid) AS seat_limit
      FROM users
     WHERE tenant_id = :tid
     GROUP BY role
""")


async def _people(db: AsyncSession, ctx: DashContext) -> dict:
    rows = (await db.execute(_PEOPLE_SQL, {"tid": ctx.tenant_id})).all()
    seat_limit = next((r[3] for r in rows if r[3] is not None), None)
    return {
        "seat_limit": int(seat_limit) if seat_limit is not None else None,
        "roles": [{"role": r, "active": int(a or 0), "inactive": int(i or 0)} for r, a, i, _limit in rows],
        "source": ["users.role", "users.is_active", "tenants.seat_limit"],
    }


def _delegation_open(d, module: str):
    """A delegation still has work: the module's own sites while the module is
    open, and companion work (financial closure, quality audit) while that is
    open, which can be after the project itself is done."""
    own = and_(d.module == module, _module_open(module))
    companion = _COMPANION_DELEGATION_MODULE.get(module)
    if companion == "financial_closure":
        return or_(own, and_(d.module == companion, S.financial_closure_status != "closed"))
    if companion == "quality_audit":
        return or_(own, and_(d.module == companion, _project(lambda r: (r.quality_audit_status != "approved",))))
    return own


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
                   d.module.in_(_delegation_modules(ctx.module or "")), _delegation_open(d, ctx.module or ""))
        )
    stmt = stmt.group_by(u.id, u.name).order_by(text("n DESC")).limit(_TOP_N)
    items = [{"user_id": str(i), "name": nm, "open_sites": int(n)} for i, nm, n in (await db.execute(stmt)).all()]
    return {"items": items, "source": ["sites.assigned_to", "site_delegations"]}


async def _money(db: AsyncSession, ctx: DashContext) -> dict:
    open_ = S.status.notin_(_CLOSED)
    r = await _first_row(db, select(
        func.coalesce(func.sum(S.expected_rent).filter(S.is_launched.is_(True)), 0).label("rent_live"),
        func.coalesce(func.sum(S.expected_rent).filter(and_(open_, S.is_launched.is_(False))), 0).label("rent_pipeline"),
        func.coalesce(func.sum(S.finance_amount).filter(S.finance_status == "approved"), 0).label("finance_approved"),
        func.coalesce(func.sum(S.finance_amount).filter(S.finance_status.in_(("awaiting_supervisor", "awaiting_admin"))), 0).label("finance_pending"),
    ).where(*site_filters(ctx)))
    b = models.SiteBudget
    budgets = (await db.execute(
        select(b.phase, func.coalesce(func.sum(b.budget_total), 0), func.count())
        .where(b.tenant_id == ctx.tenant_id).group_by(b.phase)
    )).all()
    return {
        **{k: float(r.get(k) or 0) for k in ("rent_live", "rent_pipeline", "finance_approved", "finance_pending")},
        "budgets": [{"phase": p, "total": float(t or 0), "sites": int(n)} for p, t, n in budgets],
        "source": ["sites.expected_rent", "sites.finance_amount", "site_budgets.budget_total"],
    }


# ── Builders ─────────────────────────────────────────────────────────────────

async def _admin_payload(db: AsyncSession, ctx: DashContext) -> dict:
    kpis = await _kpis(db, ctx)
    inbox = await _admin_inbox(db, ctx)
    # The admin's "awaiting" tile is their own queues, so it always agrees with
    # the inbox right below it (sites awaiting a BD supervisor are not theirs).
    for tile in kpis["tiles"]:
        if tile["key"] == "awaiting":
            tile["value"] = inbox["total"]
    return {
        "kpis": kpis,
        "inbox": inbox,
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
    """Only what this module's supervisor acts on. Cities, cycle times and LOIs
    are BD's; NSO has no executives, so no workload there."""
    out: dict[str, Any] = {
        "kpis": await _kpis(db, ctx),
        "inbox": await _action_inbox(db, ctx),
        "funnel": await (_bd_funnel(db, ctx) if ctx.is_bd else _module_funnel(db, ctx)),
    }
    # Legal and Project Excellence break down the same column their stage
    # funnel already shows, so a second card would only repeat it (with a
    # different total, since it leaves closed sites out).
    if not ctx.is_bd and ctx.module not in ("nso", "legal", "project_excellence"):
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
    else:
        out["workload"] = await _workload(db, ctx)
    out["activity"] = await _activity(db, ctx)
    return out


async def _executive_payload(db: AsyncSession, ctx: DashContext) -> dict:
    """The executive's own queue. NSO is supervisor-only (routers/nso.py), so an
    NSO executive gets a short notice instead of empty charts."""
    if ctx.module == "nso":
        return {
            "kpis": {"tiles": [], "source": []},
            "notice": {"title": "NSO is run by supervisors",
                       "body": "New store openings are handled by NSO supervisors. Ask your supervisor for NSO "
                               "supervisor access if you need to work on a store opening.",
                       "source": ["routers/nso.py"]},
            "activity": await _activity(db, ctx),
        }
    out: dict[str, Any] = {
        "kpis": await _kpis(db, ctx),
        "inbox": await _action_inbox(db, ctx),
        "funnel": await (_bd_funnel(db, ctx) if ctx.is_bd else _module_funnel(db, ctx)),
    }
    if ctx.is_bd:
        out["cities"] = await _cities(db, ctx)
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
    scope = ctx.scope if ctx.kind == "supervisor" else ("tenant" if ctx.kind == "admin" else "personal")
    return _envelope(ctx, ctx.module if ctx.kind != "admin" else None, scope, sections)


def _envelope(ctx: DashContext, module: Optional[str], scope: str, sections: dict) -> dict:
    """Wrap the sections in the payload header both summary routes share."""
    as_of = datetime.now(timezone.utc).isoformat()
    for section in sections.values():
        section.setdefault("as_of", as_of)
    return {"role": ctx.kind, "module": module, "scope": scope, "simulated": ctx.simulated,
            "generated_at": as_of, **sections}


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
      (SELECT count(*) FROM users WHERE tenant_id = :tid AND is_active) AS active_users,
      -- Due windows, waiting ages and "launching soon" move with the calendar,
      -- not with any row, so the date is part of the version too.
      current_date AS today,
      -- Queues the admin and executive inboxes count. Creating or deciding one
      -- of these writes no audit event, so without them the poll could answer
      -- 304 while a queue had changed.
      (SELECT count(*) FROM users WHERE tenant_id = :tid) AS all_users,
      (SELECT count(*) FROM supervisor_executive_requests WHERE tenant_id = :tid AND status = 'pending') AS exec_requests,
      (SELECT count(*) FROM supervisor_module_access_grants WHERE tenant_id = :tid AND status = 'pending') AS module_grants,
      (SELECT count(*) FROM executive_module_access_grants WHERE tenant_id = :tid AND status = 'pending') AS exec_module_grants,
      (SELECT count(*) FROM legal_change_requests WHERE tenant_id = :tid AND status = 'pending') AS change_requests,
      (SELECT GREATEST(max(created_at), max(decided_at)) FROM supervisor_executive_requests WHERE tenant_id = :tid) AS exec_requests_at,
      (SELECT GREATEST(max(created_at), max(decided_at), max(revoked_at)) FROM supervisor_module_access_grants WHERE tenant_id = :tid) AS module_grants_at,
      (SELECT GREATEST(max(created_at), max(decided_at), max(revoked_at)) FROM executive_module_access_grants WHERE tenant_id = :tid) AS exec_module_grants_at,
      (SELECT max(updated_at) FROM legal_change_requests WHERE tenant_id = :tid) AS change_requests_at
""")


async def get_version(db: AsyncSession, tenant_id: str) -> str:
    """A short hash that changes whenever anything a dashboard shows changes.

    The timestamps come from now(), the start time of the writing transaction,
    so a long transaction that commits after a shorter one can land below the
    current max and not move the hash. That is rare and self-correcting (the
    next change moves it), and the counts in the query usually catch it.

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
    return _envelope(ctx, "nso", "module", await _supervisor_payload(db, ctx))
