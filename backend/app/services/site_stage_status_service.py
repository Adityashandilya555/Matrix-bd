"""Build the read-only per-stage status projection (BD process-flow visibility).

Mirrors the pipeline node-state logic the BD tracker renders on the client, but
enriches each stage with the sub-status detail that only lives in the downstream
module tables (design deliverables, project milestones, NSO licences) plus a
recent slice of the stage_events audit trail. Strictly read-only.
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.domain.schemas.site_stage_status import (
    SiteStageStatusResponse,
    StageBlock,
    StageStatusRow,
    StageTimelineEntry,
)
from app.services._common import (
    assert_executive_owns_site,
    fetch_site_or_404,
    fetch_user_names,
)

_ACTIVE_PROJECT_STATUSES = {"pending", "allocated", "budgeting", "in_progress"}

_POSITIVE = {"positive", "complete", "approved", "registered", "executed", "signed",
             "done", "yes", "launched", "supervisor_approved"}
_NEGATIVE = {"negative", "rejected", "no", "failed"}
_PENDING = {"pending", "", "not started", "queued", None}


def _pretty(value) -> str:
    if value is None or value == "":
        return "Pending"
    return str(value).replace("_", " ").strip().title()


def _tone(value) -> str:
    v = str(value or "").lower()
    if v in _POSITIVE:
        return "positive"
    if v in _NEGATIVE:
        return "negative"
    if v in _PENDING:
        return "neutral"
    return "active"


def _row(label: str, value) -> StageStatusRow:
    return StageStatusRow(label=label, value=_pretty(value), tone=_tone(value))


# ── Per-stage state (kept in lockstep with the client node-state logic) ───────

def _legal_state(site) -> str:
    if site.status == "legal_rejected" or site.legal_dd_status == "negative":
        return "rejected"
    if (
        site.status in ("legal_approved", "pushed_to_payments")
        or (site.legal_dd_status == "positive"
            and site.agreement_status == "registered"
            and site.licensing_status == "complete")
    ):
        return "complete"
    return "active"


def _budget_approved(excellence) -> bool:
    return bool(excellence) and excellence.status == "approved"


_NSO_STAGE_ORDER = {"stage_one": 1, "stage_two": 2, "stage_three": 3}


def _nso_stage_value(nso, idx: int) -> str:
    """complete / active / pending for NSO stage `idx` (1..3)."""
    completed = getattr(nso, f"stage_{['one', 'two', 'three'][idx - 1]}_completed_at", None)
    if completed:
        return "complete"
    current = _NSO_STAGE_ORDER.get(nso.current_stage, 1)
    if idx < current:
        return "complete"
    if idx == current:
        return "active"
    return "pending"


# Per-node state derivation. Each takes the shared `ctx` (which carries `site`
# plus the pre-fetched project / nso / launch / excellence rows + finance &
# design status). Split into small functions so none trips the complexity gate.

def _st_ca(ctx) -> str:
    site = ctx["site"]
    if ctx["finance_status"] == "approved" or site.status == "pushed_to_payments":
        return "complete"
    return "active" if _legal_state(site) == "complete" else "future"


def _st_design(ctx) -> str:
    if ctx["design_status"] == "approved":
        return "complete"
    if ctx["finance_status"] == "approved" and ctx["site"].status == "pushed_to_payments":
        return "active"
    return "future"


def _st_excellence(ctx) -> str:
    if _budget_approved(ctx["excellence"]):
        return "complete"
    return "active" if ctx["design_status"] == "approved" else "future"


def _st_project(ctx) -> str:
    pstatus = ctx["project"].project_status if ctx["project"] else None
    if pstatus == "done":
        return "complete"
    if ctx["design_status"] == "approved" and (not pstatus or pstatus in _ACTIVE_PROJECT_STATUSES):
        return "active"
    return "future"


def _st_nso(ctx) -> str:
    nso = ctx["nso"]
    if nso and nso.nso_status == "complete":
        return "complete"
    return "active" if (ctx["project"] and ctx["project"].project_status == "done") else "future"


def _st_launch(ctx) -> str:
    site, launch, nso = ctx["site"], ctx["launch"], ctx["nso"]
    if getattr(site, "is_launched", False) or (launch and launch.status == "launched"):
        return "complete"
    return "active" if (nso and nso.nso_status == "complete") else "future"


_STATE_FNS = {
    "ca": _st_ca,
    "design": _st_design,
    "excellence": _st_excellence,
    "project": _st_project,
    "nso": _st_nso,
    "launch": _st_launch,
}


def _stage_state(node_id, ctx) -> str:
    if node_id == "loi":
        return "complete"
    if node_id == "legal":
        return _legal_state(ctx["site"])
    fn = _STATE_FNS.get(node_id)
    return fn(ctx) if fn else "future"


def _state_label(node_id, state) -> str:
    if state == "complete":
        return "DONE" if node_id == "loi" else "COMPLETE"
    if state == "active":
        return "PENDING" if node_id in ("ca", "excellence", "project", "nso", "launch") else "OPEN"
    if state == "rejected":
        return "REJECTED"
    return "QUEUED"


def _headline(site, *, project, nso, launch, design_status) -> str:
    if getattr(site, "is_launched", False) or (launch and launch.status == "launched"):
        return "Site launched and workflow complete"
    if nso and nso.nso_status == "complete":
        return "NSO complete, launch approval is active"
    if project and project.project_status == "done":
        return "Project completed, NSO is active"
    if design_status == "approved":
        return "Design approved, Project Execution is active"
    legal = _legal_state(site)
    if legal == "rejected":
        return "BD notified, legal correction required"
    if legal == "complete":
        return "Legal cleared, ready for downstream handoff"
    if legal == "active":
        return "Legal team is updating DDR, agreement, or licensing"
    return "Signed LOI received, awaiting Legal action"


# ── Per-stage row builders (kept small so the assembler stays under the
# complexity gate). Each returns the labelled rows for one department. ──

_DD_CHECKS = [
    ("title_doc", "Title / ownership"),
    ("sanctioned_plan", "Sanctioned plan"),
    ("oc_cc", "OC / CC"),
    ("commercial_use", "Commercial usage"),
    ("property_tax", "Property tax"),
    ("electricity", "Electricity"),
    ("fire_noc", "Fire NOC"),
]


def _legal_rows(site, dd):
    """Rows + a `has_negative` flag (negative verdict OR any DD check == 'no')."""
    rows = [
        _row("Due-diligence verdict", site.legal_dd_status),
        _row("Agreement", site.agreement_status),
        _row("Licensing", site.licensing_status),
    ]
    negative = str(site.legal_dd_status or "").lower() == "negative"
    if not dd:
        return rows, negative
    negative = negative or str(dd.final_verdict or "").lower() == "negative"
    for field, label in _DD_CHECKS:
        value = getattr(dd, field, None)
        rows.append(_row(label, value))
        negative = negative or str(value or "").lower() == "no"
    for field, label_field in (("other_1", "other_1_label"), ("other_2", "other_2_label")):
        value = getattr(dd, field, None)
        if value and str(value).lower() != "pending":
            rows.append(_row(getattr(dd, label_field, None) or label_field.replace("_label", ""), value))
            negative = negative or str(value).lower() == "no"
    return rows, negative


def _ca_rows(site, finance_status):
    ca_code = getattr(site, "ca_code", None)
    return [
        _row("KYC verified", "yes" if getattr(site, "kyc_verified", False) else "pending"),
        StageStatusRow(label="CA / commercial code", value=ca_code or "Not set",
                       tone="positive" if ca_code else "neutral"),
        _row("Finance approval", finance_status),
    ]


def _design_rows(deliverables, design_review):
    by_kind = {d.kind: d for d in deliverables}
    labels = [("recce", "Recce"), ("2d", "2D drawings"), ("3d", "3D drawings"), ("boq", "BOQ")]
    rows = [_row(label, by_kind[kind].status if kind in by_kind else "pending") for kind, label in labels]
    note = None
    if design_review:
        rows.append(_row("GFC gate", design_review.gfc_status))
        note = f"Active stage: {_pretty(design_review.current_stage)}"
    return rows, note


def _excellence_rows(excellence, design_status):
    # Single high-level status — no line-item budget detail on this surface.
    if _budget_approved(excellence):
        return [_row("Budgeting", "completed")]
    if excellence is not None:
        return [_row("Budgeting", "in progress")]
    if design_status == "approved":
        return [_row("Budgeting", "pending")]
    return [_row("Budgeting", "not started")]


def _project_rows(project):
    if not project:
        return [_row("Project status", "pending")], None
    rows = [
        _row("Project status", project.project_status),
        _row("Initialization", project.initialization_status),
        _row("Expected completion", project.expected_completion_status),
        _row("Quality audit", project.quality_audit_status),
        _row("NSO handoff", project.nso_status),
    ]
    return rows, f"Active stage: {_pretty(project.current_stage)}"


def _nso_rows(nso):
    if not nso:
        return [_row("NSO status", "pending")], None
    rows = [
        _row("NSO status", nso.nso_status),
        _row("Stage 1 · Property & docs", _nso_stage_value(nso, 1)),
        _row("Stage 2 · Licences", _nso_stage_value(nso, 2)),
        _row("Stage 3 · Handover & launch", _nso_stage_value(nso, 3)),
        _row("FSSAI", nso.fssai_status),
        _row("Health / trade", nso.health_trade_status),
        _row("Fire NOC", nso.fire_noc_status),
    ]
    return rows, f"Active stage: {_pretty(nso.current_stage)}"


def _launch_rows(site, launch):
    rows = [_row("Launch approval", launch.status if launch else "pending")]
    if getattr(site, "launched_at", None):
        rows.append(StageStatusRow(label="Launched at", value=str(site.launched_at)[:10], tone="positive"))
    return rows


def _make_block(node_id, title, ctx, rows, note=None) -> StageBlock:
    state = _stage_state(node_id, ctx)
    return StageBlock(
        id=node_id, title=title, state=state,
        state_label=_state_label(node_id, state), rows=rows, note=note,
    )


def _build_stage_blocks(ctx, *, dd, deliverables, design_review):
    """Assemble every stage block + the legal-negative flag from prefetched rows."""
    site = ctx["site"]
    legal_rows, legal_negative = _legal_rows(site, dd)
    design_rows, design_note = _design_rows(deliverables, design_review)
    project_rows, project_note = _project_rows(ctx["project"])
    nso_rows, nso_note = _nso_rows(ctx["nso"])
    blocks = [
        _make_block("loi", "BD LOI Signed", ctx,
                    [StageStatusRow(label="LOI", value="Signed", tone="positive")]),
        _make_block("legal", "Legal & Compliance", ctx, legal_rows),
        _make_block("ca", "CA / Commercial Code", ctx, _ca_rows(site, ctx["finance_status"])),
        _make_block("design", "Design / Technical", ctx, design_rows, design_note),
        _make_block("excellence", "Project Excellence", ctx,
                    _excellence_rows(ctx["excellence"], ctx["design_status"])),
        _make_block("project", "Project Execution", ctx, project_rows, project_note),
        _make_block("nso", "NSO", ctx, nso_rows, nso_note),
        _make_block("launch", "Site Launched", ctx, _launch_rows(site, ctx["launch"])),
    ]
    return blocks, legal_negative


async def build_stage_status_response(
    db: AsyncSession,
    *,
    site_id: str | UUID,
    tenant_id: str | UUID,
    current_user: dict,
) -> SiteStageStatusResponse:
    """Build the read-only per-department stage-status projection for a site.

    Folds the cross-module foreign-key tables (legal DD checklist, design
    deliverables, project milestones, NSO stages, budget) into labelled rows,
    derives the legal-negative flag, and attaches a recent stage-events timeline.
    """
    site = await fetch_site_or_404(db, site_id=site_id, tenant_id=tenant_id)

    caller_module = (current_user.get("module") or "").lower()
    if caller_module in ("", "bd"):
        assert_executive_owns_site(current_user, site)

    design_status = getattr(site, "design_status", "pending") or "pending"
    finance_status = getattr(site, "finance_status", "pending") or "pending"

    # Fold the six 1:1 child tables into a single LEFT JOIN instead of six
    # sequential single-row roundtrips (#376). Each is one-per-site (project /
    # nso / launch / design_review / legal_dd) or one-per-(site, phase)
    # (site_budget at the 'gfc' phase = Project Excellence — the private
    # project_excellence_reviews table is retired). The phase filter lives in the
    # JOIN condition so it stays a LEFT join.
    row = (await db.execute(
        select(
            models.ProjectReview, models.NsoReview, models.LaunchApproval,
            models.DesignReview, models.LegalDdChecklist, models.SiteBudget,
        )
        .select_from(models.Site)
        .outerjoin(models.ProjectReview, models.ProjectReview.site_id == models.Site.id)
        .outerjoin(models.NsoReview, models.NsoReview.site_id == models.Site.id)
        .outerjoin(models.LaunchApproval, models.LaunchApproval.site_id == models.Site.id)
        .outerjoin(models.DesignReview, models.DesignReview.site_id == models.Site.id)
        .outerjoin(models.LegalDdChecklist, models.LegalDdChecklist.site_id == models.Site.id)
        .outerjoin(
            models.SiteBudget,
            (models.SiteBudget.site_id == models.Site.id) & (models.SiteBudget.phase == "gfc"),
        )
        .where(models.Site.id == site.id)
    )).first()
    if row is None:
        project = nso = launch = design_review = dd = excellence = None
    else:
        project, nso, launch, design_review, dd, excellence = row

    deliverables = (await db.execute(
        select(models.DesignDeliverable).where(models.DesignDeliverable.site_id == site.id)
    )).scalars().all()

    ctx = dict(
        site=site, project=project, nso=nso, launch=launch,
        finance_status=finance_status, design_status=design_status,
        excellence=excellence,
    )

    stages, legal_has_negative = _build_stage_blocks(
        ctx, dd=dd, deliverables=deliverables, design_review=design_review,
    )

    # ── Timeline (recent stage transitions) ──
    events = (await db.execute(
        select(models.StageEvent)
        .where(models.StageEvent.site_id == site.id)
        .order_by(models.StageEvent.occurred_at.desc())
        .limit(15)
    )).scalars().all()
    names = await fetch_user_names(db, [e.actor_id for e in events])
    timeline = [
        StageTimelineEntry(
            event_type=e.event_type,
            from_status=e.from_status,
            to_status=e.to_status,
            actor_role=e.actor_role,
            actor_name=names.get(e.actor_id),
            occurred_at=e.occurred_at,
        )
        for e in events
    ]

    return SiteStageStatusResponse(
        site_id=str(site.id),
        site_code=site.ca_code or site.code or "",
        site_name=site.name,
        city=site.city,
        headline=_headline(site, **{k: ctx[k] for k in ("project", "nso", "launch", "design_status")}),
        legal_has_negative=legal_has_negative,
        stages=stages,
        timeline=timeline,
    )
