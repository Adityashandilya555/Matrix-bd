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


def _stage_state(site, node_id, *, project, nso, launch, finance_status, design_status) -> str:
    if node_id == "loi":
        return "complete"
    if node_id == "legal":
        return _legal_state(site)
    if node_id == "ca":
        if finance_status == "approved" or site.status == "pushed_to_payments":
            return "complete"
        if _legal_state(site) == "complete":
            return "active"
    if node_id == "design":
        if design_status == "approved":
            return "complete"
        if finance_status == "approved" and site.status == "pushed_to_payments":
            return "active"
    if node_id == "project":
        pstatus = project.project_status if project else None
        if pstatus == "done":
            return "complete"
        if design_status == "approved" and (not pstatus or pstatus in _ACTIVE_PROJECT_STATUSES):
            return "active"
    if node_id == "nso":
        if nso and nso.nso_status == "complete":
            return "complete"
        if project and project.project_status == "done":
            return "active"
    if node_id == "launch":
        if getattr(site, "is_launched", False) or (launch and launch.status == "launched"):
            return "complete"
        if nso and nso.nso_status == "complete":
            return "active"
    return "future"


def _state_label(node_id, state) -> str:
    if state == "complete":
        return "DONE" if node_id == "loi" else "COMPLETE"
    if state == "active":
        return "PENDING" if node_id in ("ca", "project", "nso", "launch") else "OPEN"
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


async def build_stage_status_response(
    db: AsyncSession,
    *,
    site_id: str | UUID,
    tenant_id: str | UUID,
    current_user: dict,
) -> SiteStageStatusResponse:
    site = await fetch_site_or_404(db, site_id=site_id, tenant_id=tenant_id)

    caller_module = (current_user.get("module") or "").lower()
    if caller_module in ("", "bd"):
        assert_executive_owns_site(current_user, site)

    design_status = getattr(site, "design_status", "pending") or "pending"
    finance_status = getattr(site, "finance_status", "pending") or "pending"

    project = (await db.execute(
        select(models.ProjectReview).where(models.ProjectReview.site_id == site.id)
    )).scalar_one_or_none()
    nso = (await db.execute(
        select(models.NsoReview).where(models.NsoReview.site_id == site.id)
    )).scalar_one_or_none()
    launch = (await db.execute(
        select(models.LaunchApproval).where(models.LaunchApproval.site_id == site.id)
    )).scalar_one_or_none()
    deliverables = (await db.execute(
        select(models.DesignDeliverable).where(models.DesignDeliverable.site_id == site.id)
    )).scalars().all()
    design_review = (await db.execute(
        select(models.DesignReview).where(models.DesignReview.site_id == site.id)
    )).scalar_one_or_none()

    common = dict(
        project=project, nso=nso, launch=launch,
        finance_status=finance_status, design_status=design_status,
    )

    def block(node_id, title, rows, note=None) -> StageBlock:
        state = _stage_state(site, node_id, **common)
        return StageBlock(
            id=node_id, title=title, state=state,
            state_label=_state_label(node_id, state),
            rows=rows, note=note,
        )

    # ── Legal ──
    legal_rows = [
        _row("Due-diligence verdict", site.legal_dd_status),
        _row("Agreement", site.agreement_status),
        _row("Licensing", site.licensing_status),
    ]

    # ── CA / Finance ──
    ca_rows = [
        _row("KYC verified", "yes" if getattr(site, "kyc_verified", False) else "pending"),
        StageStatusRow(label="CA / commercial code",
                       value=getattr(site, "ca_code", None) or "Not set",
                       tone="positive" if getattr(site, "ca_code", None) else "neutral"),
        _row("Finance approval", finance_status),
    ]

    # ── Design ── (deliverables: recce / 2d / 3d / boq)
    by_kind = {d.kind: d for d in deliverables}
    design_labels = [("recce", "Recce"), ("2d", "2D drawings"),
                     ("3d", "3D drawings"), ("boq", "BOQ")]
    design_rows = [
        _row(label, by_kind[kind].status if kind in by_kind else "pending")
        for kind, label in design_labels
    ]
    if design_review:
        design_rows.append(_row("GFC gate", design_review.gfc_status))
    design_note = None
    if design_review:
        design_note = f"Active stage: {_pretty(design_review.current_stage)}"

    # ── Project execution ──
    if project:
        project_rows = [
            _row("Project status", project.project_status),
            _row("Initialization", project.initialization_status),
            _row("Expected completion", project.expected_completion_status),
            _row("Quality audit", project.quality_audit_status),
        ]
        project_note = f"Active stage: {_pretty(project.current_stage)}"
    else:
        project_rows = [_row("Project status", "pending")]
        project_note = None

    # ── NSO ── (statutory licences)
    if nso:
        nso_rows = [
            _row("NSO status", nso.nso_status),
            _row("FSSAI", nso.fssai_status),
            _row("Health / trade", nso.health_trade_status),
            _row("Shops & establishment", nso.shops_estab_status),
            _row("Fire NOC", nso.fire_noc_status),
            _row("Storage licence", nso.storage_license_status),
        ]
        nso_note = f"Active stage: {_pretty(nso.current_stage)}"
    else:
        nso_rows = [_row("NSO status", "pending")]
        nso_note = None

    # ── Launch ──
    launch_rows = [
        _row("Launch approval", launch.status if launch else "pending"),
    ]
    if getattr(site, "launched_at", None):
        launch_rows.append(StageStatusRow(
            label="Launched at",
            value=str(site.launched_at)[:10],
            tone="positive",
        ))

    stages = [
        block("loi", "BD LOI Signed",
              [StageStatusRow(label="LOI", value="Signed", tone="positive")]),
        block("legal", "Legal & Compliance", legal_rows),
        block("ca", "CA / Commercial Code", ca_rows),
        block("design", "Design / Technical", design_rows, design_note),
        block("project", "Project Execution", project_rows, project_note),
        block("nso", "NSO", nso_rows, nso_note),
        block("launch", "Site Launched", launch_rows),
    ]

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
        site_code=site.code or "",
        site_name=site.name,
        city=site.city,
        headline=_headline(site, **{k: common[k] for k in ("project", "nso", "launch", "design_status")}),
        stages=stages,
        timeline=timeline,
    )
