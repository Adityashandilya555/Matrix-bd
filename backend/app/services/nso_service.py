"""NSO service.

NSO opens after Finance / CA is approved, then advances as Project milestones
unlock. The module owns only NSO readiness fields; Finance and Project remain
the source of truth for the external triggers.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.db.session import transaction
from app.domain.schemas.nso import (
    NsoHistoryResponse,
    NsoLegalLicensingSnapshot,
    NsoQueueItem,
    NsoQueueResponse,
    NsoPropertySnapshot,
    NsoStageOneRequest,
    NsoStageThreeRequest,
    NsoStageTwoRequest,
    NsoStateResponse,
    NsoTriggerState,
)
from app.services._common import fetch_site_or_404, fetch_user_name
from app.services.audit_service import write_audit_event
from app.services.launch_service import svc_create_launch_approval

logger = logging.getLogger(__name__)


LEGAL_LICENSE_FIELDS = (
    "fssai",
    "health_trade",
    "shops_estab_reg",
    "fire_noc",
    "storage_license",
)

# NSO Stage 2 readiness fields → the canonical Legal Licensing field each one
# *reflects*. Stage 2 is derived from Legal Licensing (see _state_response and
# #229); the NsoReview.*_status columns are never synced from licensing, so the
# Stage 2 contract (and the dropped-body divergence check) must read the licensing
# snapshot, not the row.
_STAGE_TWO_STATUS_TO_LICENSE = {
    "fssai_status": "fssai",
    "health_trade_status": "health_trade",
    "shops_estab_status": "shops_estab_reg",
    "fire_noc_status": "fire_noc",
    "storage_license_status": "storage_license",
}
_STAGE_TWO_STATUS_FIELDS = tuple(_STAGE_TWO_STATUS_TO_LICENSE)


async def _fetch_project(
    session: AsyncSession, *, site_id: str | UUID,
) -> Optional[models.ProjectReview]:
    return (await session.execute(
        select(models.ProjectReview).where(models.ProjectReview.site_id == site_id)
    )).scalar_one_or_none()


async def _fetch_site_detail(
    session: AsyncSession, *, site_id: str | UUID,
) -> Optional[models.SiteDetail]:
    return (await session.execute(
        select(models.SiteDetail).where(models.SiteDetail.site_id == site_id)
    )).scalar_one_or_none()


async def _fetch_licensing(
    session: AsyncSession, *, site_id: str | UUID,
) -> Optional[models.SiteLicensing]:
    return (await session.execute(
        select(models.SiteLicensing).where(models.SiteLicensing.site_id == site_id)
    )).scalar_one_or_none()


def _num(value) -> Optional[float]:
    return float(value) if value is not None else None


def _property_summary(snapshot: NsoPropertySnapshot) -> str:
    parts = [
        f"Site: {snapshot.site_name}",
        f"City: {snapshot.city}",
    ]
    if snapshot.model:
        parts.append(f"Model: {snapshot.model}")
    if snapshot.ca_code:
        parts.append(f"CA code: {snapshot.ca_code}")
    if snapshot.rent_type:
        parts.append(f"Rent type: {snapshot.rent_type}")
    return " | ".join(parts)


async def _property_snapshot(
    session: AsyncSession, *, site: models.Site,
) -> NsoPropertySnapshot:
    details = await _fetch_site_detail(session, site_id=site.id)
    return NsoPropertySnapshot(
        site_name=site.name,
        site_code=site.ca_code or site.code or "",
        city=site.city,
        visit_date=site.visit_date,
        model=site.model,
        google_maps_pin=site.google_maps_pin,
        google_maps_url=site.google_maps_url,
        ca_code=site.ca_code,
        finance_amount=_num(site.finance_amount),
        kyc_verified=bool(site.kyc_verified),
        rent_type=(details.rent_type if details and details.rent_type else site.rent_type),
        expected_rent=_num(site.expected_rent),
        expected_revshare_pct=_num(
            details.rev_share_pct if details and details.rev_share_pct is not None else site.expected_revshare_pct
        ),
        expected_escalation_pct=_num(
            details.escalation_pct if details and details.escalation_pct is not None else site.expected_escalation_pct
        ),
        expected_escalation_years=site.expected_escalation_years,
        score=_num(details.score) if details else None,
        estimated_monthly_sales=_num(details.estimated_monthly_sales) if details else None,
        carpet_area_sqft=_num(details.carpet_area_sqft) if details else None,
        cam_charges=_num(details.cam_charges) if details else None,
        security_deposit=_num(details.security_deposit) if details else None,
        brokerage=_num(details.brokerage) if details else None,
        lock_in_months=details.lock_in_months if details else None,
        tenure_months=details.tenure_months if details else None,
        rent_free_days=details.rent_free_days if details else None,
        nearest_starbucks_m=details.nearest_starbucks_m if details else None,
        nearest_twc_m=details.nearest_twc_m if details else None,
    )


async def _fetch_nso_or_none(
    session: AsyncSession, *, site_id: str | UUID,
) -> Optional[models.NsoReview]:
    return (await session.execute(
        select(models.NsoReview).where(models.NsoReview.site_id == site_id)
    )).scalar_one_or_none()


async def _fetch_nso_or_create(
    session: AsyncSession, *, site: models.Site,
) -> models.NsoReview:
    row = await _fetch_nso_or_none(session, site_id=site.id)
    if row is not None:
        return row
    row = models.NsoReview(tenant_id=site.tenant_id, site_id=site.id)
    session.add(row)
    await session.flush()
    return row


async def svc_open_nso_at_stage_three(
    session: AsyncSession,
    *,
    site: models.Site,
    project: Optional[models.ProjectReview] = None,
) -> models.NsoReview:
    """Open (or advance) the NSO record at stage three — called by the Project
    module when its NSO-Handover tab pushes a project-completed site in. The
    rest of the NSO flow (stage-three fill → final approval → launch → BD review
    loop) is unchanged."""
    row = await _fetch_nso_or_create(session, site=site)
    if row.handover_pushed_at is None:
        now = datetime.now(timezone.utc)
        row.handover_pushed_at = now
        # The project handover implicitly satisfies stage 1 (CA/token approval) and
        # stage 2 (project-initiation approval) — stamp their completion so the NSO
        # audit trail is consistent (the record opens directly at stage three).
        if row.stage_one_completed_at is None:
            row.stage_one_completed_at = now
        if row.stage_two_completed_at is None:
            row.stage_two_completed_at = now
    if project is None:
        project = (await session.execute(
            select(models.ProjectReview).where(models.ProjectReview.site_id == site.id)
        )).scalar_one_or_none()
    licensing = (await session.execute(
        select(models.SiteLicensing).where(models.SiteLicensing.site_id == site.id)
    )).scalar_one_or_none()
    _sync_rollups(site, row, project, licensing)
    return row


def _trigger_one_unlocked(site: models.Site) -> bool:
    return (site.finance_status or "pending") == "approved" and bool(site.ca_code)


def _project_init_unlocked(project: Optional[models.ProjectReview]) -> bool:
    return bool(
        project
        and project.initialization_date
        and project.initialization_status == "approved"
    )


def _project_done(project: Optional[models.ProjectReview]) -> bool:
    return bool(project and (project.project_status == "done" or project.project_completed_at or project.final_completion_date))


def _stage_one_complete(row: models.NsoReview) -> bool:
    return row.communication_floated is not None


def _legal_license_values(licensing: Optional[models.SiteLicensing]) -> dict[str, str]:
    if licensing is None:
        return dict.fromkeys(LEGAL_LICENSE_FIELDS, "pending")
    return {field: (getattr(licensing, field) or "pending") for field in LEGAL_LICENSE_FIELDS}


def _legal_licensing_complete(site: models.Site, licensing: Optional[models.SiteLicensing]) -> bool:
    values = _legal_license_values(licensing)
    return bool(
        licensing
        and (site.licensing_status or "pending") == "complete"
        and all(value == "yes" for value in values.values())
    )


def _legacy_done(value: str) -> str:
    return "done" if value == "yes" else "pending"


def _legal_licensing_snapshot(
    site: models.Site, licensing: Optional[models.SiteLicensing],
) -> NsoLegalLicensingSnapshot:
    values = _legal_license_values(licensing)
    return NsoLegalLicensingSnapshot(
        overall_status=site.licensing_status or "pending",
        stage=licensing.stage if licensing else None,
        complete=_legal_licensing_complete(site, licensing),
        fssai=values["fssai"],
        health_trade=values["health_trade"],
        shops_estab_reg=values["shops_estab_reg"],
        fire_noc=values["fire_noc"],
        storage_license=values["storage_license"],
    )


def _stage_two_canonical_status(
    site: models.Site, licensing: Optional[models.SiteLicensing],
) -> dict[str, str]:
    """Stage 2 status fields as derived from canonical Legal Licensing.

    Uses the exact derivation _state_response surfaces to clients
    (``_legacy_done`` of each licensing field), so callers comparing a submitted
    body against "canonical" read the real source of truth — NOT the never-synced
    ``NsoReview.*_status`` columns, which would yield false divergences (#229).
    """
    snapshot = _legal_licensing_snapshot(site, licensing)
    return {
        field: _legacy_done(getattr(snapshot, license_field))
        for field, license_field in _STAGE_TWO_STATUS_TO_LICENSE.items()
    }


def _stage_three_complete(row: models.NsoReview) -> bool:
    return bool(
        row.dry_stock_order_status in {"ordered", "received"}
        and row.online_delivery_status in {"ready", "active"}
        and row.handover_checklist_signed is True
        and row.launch_date
        and row.launch_ready is not None
        and row.final_approval_signoff_1
        and row.final_approval_signoff_2
    )


def _stage_two_unlocked(row: models.NsoReview, project: Optional[models.ProjectReview]) -> bool:
    return _stage_one_complete(row) and _project_init_unlocked(project)


def _stage_three_unlocked(
    row: models.NsoReview,
    site: models.Site,
    licensing: Optional[models.SiteLicensing],
    project: Optional[models.ProjectReview],
) -> bool:
    # The project supervisor's push (handover_pushed_at) is the gate: stage three
    # never opens until a completed project is pushed in from the NSO-Handover
    # tab, even if the project is already done and legal licensing is complete.
    return (
        row.handover_pushed_at is not None
        and _stage_one_complete(row)
        and _legal_licensing_complete(site, licensing)
        and _project_done(project)
    )


def _compute_stage(
    site: models.Site,
    row: models.NsoReview,
    project: Optional[models.ProjectReview],
    licensing: Optional[models.SiteLicensing],
) -> str:
    if row.nso_status == "complete":
        return "done"
    # Handed over from the Project module's NSO-Handover tab → opens directly at
    # stage three. Stage 1 (CA/token approval) and stage 2 (project-initiation
    # approval) are already satisfied for a project-completed site.
    if row.handover_pushed_at is not None:
        return "final" if _stage_three_complete(row) else "stage_three"
    # Not handed over from Project yet → stage three must NOT open. Even a
    # project-done, legal-complete site stays at stage two until the project
    # supervisor pushes it in (svc_push_to_nso sets handover_pushed_at).
    if not _stage_one_complete(row):
        return "stage_one"
    return "stage_two"


def _display_rollups(
    site: models.Site,
    row: models.NsoReview,
    project: Optional[models.ProjectReview],
    licensing: Optional[models.SiteLicensing],
) -> tuple[str, str]:
    """Display-time (nso_status, current_stage) WITHOUT mutating the row.

    Read paths (queue / history / detail GET) must never write — `_sync_rollups`
    on a GET turned every queue load into N potential UPDATEs (and the
    row-creation variant into N INSERTs), which is what made /nso/queue take
    seconds. Rollup persistence belongs to the stage-save write paths only.
    """
    current_stage = _compute_stage(site, row, project, licensing)
    if row.nso_status == "complete":
        nso_status = "complete"
    else:
        nso_status = "in_progress" if current_stage != "stage_one" or _stage_one_complete(row) else "pending"
    return nso_status, current_stage


def _sync_rollups(
    site: models.Site,
    row: models.NsoReview,
    project: Optional[models.ProjectReview],
    licensing: Optional[models.SiteLicensing],
) -> None:
    now = datetime.now(timezone.utc)
    if _stage_one_complete(row) and row.stage_one_completed_at is None:
        row.stage_one_completed_at = now
    if _legal_licensing_complete(site, licensing) and row.stage_two_completed_at is None:
        row.stage_two_completed_at = now
    if _stage_three_complete(row) and row.stage_three_completed_at is None:
        row.stage_three_completed_at = now
    row.current_stage = _compute_stage(site, row, project, licensing)
    if row.nso_status != "complete":
        row.nso_status = "in_progress" if row.current_stage != "stage_one" or _stage_one_complete(row) else "pending"


def _triggers(
    site: models.Site,
    row: models.NsoReview,
    project: Optional[models.ProjectReview],
    licensing: Optional[models.SiteLicensing],
) -> list[NsoTriggerState]:
    trigger1 = _trigger_one_unlocked(site)
    stage1_done = _stage_one_complete(row)
    project_init = _project_init_unlocked(project)
    project_done = _project_done(project)
    stage2_done = _legal_licensing_complete(site, licensing)
    return [
        NsoTriggerState(
            key="finance_ca",
            label="CA code / Payment",
            unlocked=trigger1,
            complete=stage1_done,
            reason=None if trigger1 else "Waiting for Finance / CA approval and CA code.",
        ),
        NsoTriggerState(
            key="project_initiation",
            label="Project initiation date",
            unlocked=stage1_done and project_init,
            complete=stage2_done,
            reason=(
                None if stage1_done and project_init
                else "Complete Stage 1 and wait for approved Project initiation date."
            ),
        ),
        NsoTriggerState(
            key="project_completion",
            label="Project completion date",
            unlocked=stage1_done and stage2_done and project_done,
            complete=_stage_three_complete(row),
            reason=(
                None if stage1_done and stage2_done and project_done
                else "Complete Stage 1, Legal licensing, and wait for Project completion."
            ),
        ),
    ]


async def _queue_item(
    session: AsyncSession,
    site: models.Site,
    row: Optional[models.NsoReview],
    project: Optional[models.ProjectReview],
    licensing: Optional[models.SiteLicensing],
) -> NsoQueueItem:
    nso_status = row.nso_status if row else "pending"
    current_stage = row.current_stage if row else "stage_one"
    if row is not None:
        nso_status, current_stage = _display_rollups(site, row, project, licensing)
    next_action = "Open Stage 1"
    if row is not None:
        if nso_status == "complete":
            next_action = "Complete"
        elif current_stage == "stage_two":
            next_action = "Review Legal licenses"
        elif current_stage == "stage_three":
            next_action = "Open launch readiness"
        elif current_stage == "final":
            next_action = "Final approval"
    return NsoQueueItem(
        site_id=str(site.id),
        site_code=site.ca_code or site.code or "",
        site_name=site.name,
        city=site.city,
        finance_status=site.finance_status or "pending",
        ca_code=site.ca_code,
        project_status=(project.project_status if project else "pending"),
        project_current_stage=(project.current_stage if project else "budget"),
        nso_status=nso_status,
        current_stage=current_stage,
        next_action=next_action,
        updated_at=(row.updated_at if row else site.updated_at),
    )


async def _state_response(
    session: AsyncSession,
    site: models.Site,
    row: models.NsoReview,
    project: Optional[models.ProjectReview],
    licensing: Optional[models.SiteLicensing],
) -> NsoStateResponse:
    nso_status, current_stage = _display_rollups(site, row, project, licensing)
    snapshot = await _property_snapshot(session, site=site)
    legal_snapshot = _legal_licensing_snapshot(site, licensing)
    return NsoStateResponse(
        site_id=str(site.id),
        site_code=site.ca_code or site.code or "",
        site_name=site.name,
        city=site.city,
        tenant_id=str(site.tenant_id),
        submitted_by_name=await fetch_user_name(session, site.submitted_by),
        site_status=site.status,
        finance_status=site.finance_status or "pending",
        ca_code=site.ca_code,
        project_status=(project.project_status if project else "pending"),
        project_current_stage=(project.current_stage if project else "budget"),
        project_initialization_date=(project.initialization_date if project else None),
        project_initialization_status=(project.initialization_status if project else "pending"),
        project_final_completion_date=(project.final_completion_date if project else None),
        project_completed_at=(project.project_completed_at if project else None),
        nso_status=nso_status,
        current_stage=current_stage,
        triggers=_triggers(site, row, project, licensing),
        property_snapshot=snapshot,
        legal_licensing_snapshot=legal_snapshot,
        property_details=row.property_details,
        communication_floated=row.communication_floated,
        # Legacy compatibility fields: NSO used to own these as editable
        # "done/pending" flags. Legal Licensing is now canonical, so expose a
        # read-compatible projection for older clients without treating it as
        # the source of truth.
        fssai_status=_legacy_done(legal_snapshot.fssai),
        health_trade_status=_legacy_done(legal_snapshot.health_trade),
        shops_estab_status=_legacy_done(legal_snapshot.shops_estab_reg),
        fire_noc_status=_legacy_done(legal_snapshot.fire_noc),
        storage_license_status=_legacy_done(legal_snapshot.storage_license),
        dry_stock_order_status=row.dry_stock_order_status,
        online_delivery_status=row.online_delivery_status,
        handover_checklist_signed=row.handover_checklist_signed,
        launch_date=row.launch_date,
        launch_ready=row.launch_ready,
        final_approval_signoff_1=row.final_approval_signoff_1,
        final_approval_signoff_2=row.final_approval_signoff_2,
        stage_one_completed_at=row.stage_one_completed_at,
        stage_two_completed_at=row.stage_two_completed_at,
        stage_three_completed_at=row.stage_three_completed_at,
        final_approved_at=row.final_approved_at,
        updated_at=row.updated_at,
        is_launched=bool(site.is_launched),
        launched_at=site.launched_at,
    )


async def svc_nso_queue(
    session: AsyncSession, *, tenant_id: str | UUID, limit: int = 50, offset: int = 0,
) -> NsoQueueResponse:
    async with transaction(session):
        sites = (await session.execute(
            select(models.Site)
            .where(
                models.Site.tenant_id == tenant_id,
                models.Site.finance_status == "approved",
                models.Site.ca_code.is_not(None),
            )
            .order_by(models.Site.updated_at.asc())
            .limit(limit)
            .offset(offset)
        )).scalars().all()
        # Batch the child lookups (2 queries regardless of N) and never create
        # rows on a GET — `_queue_item` handles row=None, and the write paths
        # (`svc_save_stage_*`) create the NsoReview when work actually starts.
        # The old per-site SELECT+SELECT (+INSERT flush on first hydration)
        # made this endpoint take seconds through the pgBouncer/NullPool path
        # and let two concurrent GETs race on the site_id primary key.
        site_ids = [site.id for site in sites]
        nso_rows: dict = {}
        projects: dict = {}
        licensing_rows: dict = {}
        if site_ids:
            nso_rows = {r.site_id: r for r in (await session.execute(
                select(models.NsoReview).where(models.NsoReview.site_id.in_(site_ids))
            )).scalars()}
            projects = {p.site_id: p for p in (await session.execute(
                select(models.ProjectReview).where(models.ProjectReview.site_id.in_(site_ids))
            )).scalars()}
            licensing_rows = {l.site_id: l for l in (await session.execute(
                select(models.SiteLicensing).where(models.SiteLicensing.site_id.in_(site_ids))
            )).scalars()}
        items: list[NsoQueueItem] = [
            await _queue_item(
                session,
                site,
                nso_rows.get(site.id),
                projects.get(site.id),
                licensing_rows.get(site.id),
            )
            for site in sites
        ]
        return NsoQueueResponse(items=items, total=len(items))


async def svc_nso_history(
    session: AsyncSession, *, tenant_id: str | UUID, status_filter: str = "all",
) -> NsoHistoryResponse:
    async with transaction(session):
        stmt = (
            select(models.Site, models.NsoReview, models.ProjectReview, models.SiteLicensing)
            .outerjoin(models.NsoReview, models.NsoReview.site_id == models.Site.id)
            .outerjoin(models.ProjectReview, models.ProjectReview.site_id == models.Site.id)
            .outerjoin(models.SiteLicensing, models.SiteLicensing.site_id == models.Site.id)
            .where(
                models.Site.tenant_id == tenant_id,
                or_(
                    models.NsoReview.site_id.is_not(None),
                    (models.Site.finance_status == "approved") & models.Site.ca_code.is_not(None),
                ),
            )
        )
        if status_filter == "active":
            stmt = stmt.where(or_(models.NsoReview.nso_status.is_(None), models.NsoReview.nso_status != "complete"))
        elif status_filter in {"approved", "completed"}:
            stmt = stmt.where(models.NsoReview.nso_status == "complete")
        elif status_filter == "rejected":
            stmt = stmt.where(False)

        rows = (await session.execute(
            stmt.order_by(desc(models.NsoReview.updated_at).nulls_last(), desc(models.Site.updated_at))
        )).all()
        items = [await _queue_item(session, site, row, project, licensing) for (site, row, project, licensing) in rows]
        return NsoHistoryResponse(items=items, total=len(items))


async def svc_get_nso(
    session: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID, create: bool = True,
) -> NsoStateResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        project = await _fetch_project(session, site_id=site.id)
        licensing = await _fetch_licensing(session, site_id=site.id)
        row = await _fetch_nso_or_create(session, site=site) if create else await _fetch_nso_or_none(session, site_id=site.id)
        if row is None:
            if not _trigger_one_unlocked(site):
                raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="This site has not entered NSO.")
            row = models.NsoReview(
                tenant_id=site.tenant_id,
                site_id=site.id,
                current_stage="stage_one",
                nso_status="pending",
                fssai_status="pending",
                health_trade_status="pending",
                shops_estab_status="pending",
                fire_noc_status="pending",
                storage_license_status="pending",
                dry_stock_order_status="pending",
                online_delivery_status="pending",
                final_approval_signoff_1=False,
                final_approval_signoff_2=False,
            )
            row.updated_at = site.updated_at
        return await _state_response(session, site, row, project, licensing)


async def svc_save_stage_one(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: NsoStageOneRequest,
) -> NsoStateResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        if not _trigger_one_unlocked(site):
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="NSO Stage 1 is locked until Finance / CA is approved.")
        project = await _fetch_project(session, site_id=site.id)
        licensing = await _fetch_licensing(session, site_id=site.id)
        row = await _fetch_nso_or_create(session, site=site)
        snapshot = await _property_snapshot(session, site=site)
        if body.property_details and body.property_details.strip():
            row.property_details = body.property_details.strip()
        elif not (row.property_details or "").strip():
            row.property_details = _property_summary(snapshot)
        row.communication_floated = body.communication_floated
        _sync_rollups(site, row, project, licensing)
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="nso_stage_one_saved",
            detail="Property details and communication status captured.",
        )
        return await _state_response(session, site, row, project, licensing)


async def svc_save_stage_two(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: NsoStageTwoRequest | None = None,
) -> NsoStateResponse:
    """Reflect NSO Stage 2 readiness from canonical Legal Licensing.

    Stage 2 is **auto-derived**: its licensing status fields (FSSAI, health
    trade, shops & establishment, fire NOC, storage license) are recomputed by
    ``_sync_rollups`` from the site's Legal Licensing record — they are *not*
    authored on this endpoint. ``body`` is accepted only for backward
    compatibility with the router/clients that still POST the Stage 2 form; its
    fields are advisory and intentionally not persisted here.

    Previously the body was accepted with a typed contract and then silently
    dropped — a caller checking boxes got a 200 and believed their input saved
    (#229). We now log a WARNING whenever a submitted value diverges from the
    derived state, so the drop is observable instead of silent.

    To make these fields user-authored instead, write ``body.<field>`` onto
    ``row`` before ``_sync_rollups`` and surface them in the state response.
    """
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        project = await _fetch_project(session, site_id=site.id)
        licensing = await _fetch_licensing(session, site_id=site.id)
        row = await _fetch_nso_or_create(session, site=site)
        if not _stage_two_unlocked(row, project):
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="NSO Stage 2 is locked until Stage 1 and Project initiation are complete.")
        _sync_rollups(site, row, project, licensing)
        if body is not None:
            # Compare the submitted fields against the canonical Legal
            # Licensing-derived values (the same ones _state_response returns to
            # clients), NOT against row.*_status — those columns are never synced
            # from licensing, so comparing to them would warn on every normal save
            # and log a stale "canonical" value (#229 review).
            canonical = _stage_two_canonical_status(site, licensing)
            ignored = {
                field: getattr(body, field)
                for field in _STAGE_TWO_STATUS_FIELDS
                if getattr(body, field) != canonical[field]
            }
            if ignored:
                logger.warning(
                    "nso_stage_two: ignoring submitted status fields for site=%s; "
                    "Stage 2 reflects canonical Legal Licensing "
                    "(submitted=%s, canonical=%s)",
                    site.id, ignored,
                    {f: canonical[f] for f in ignored},
                )
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="nso_stage_two_reflected",
            detail="NSO Stage 2 refreshed from canonical Legal Licensing status.",
        )
        return await _state_response(session, site, row, project, licensing)


async def svc_save_stage_three(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: NsoStageThreeRequest,
) -> NsoStateResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        project = await _fetch_project(session, site_id=site.id)
        licensing = await _fetch_licensing(session, site_id=site.id)
        row = await _fetch_nso_or_create(session, site=site)
        if not _stage_three_unlocked(row, site, licensing, project):
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="NSO Stage 3 is locked until Legal Licensing and Project completion are complete.")
        row.dry_stock_order_status = body.dry_stock_order_status
        row.online_delivery_status = body.online_delivery_status
        row.handover_checklist_signed = body.handover_checklist_signed
        row.launch_date = body.launch_date
        row.launch_ready = body.launch_ready
        row.final_approval_signoff_1 = body.final_approval_signoff_1
        row.final_approval_signoff_2 = body.final_approval_signoff_2
        _sync_rollups(site, row, project, licensing)
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="nso_stage_three_saved",
            detail="Launch readiness checklist captured.",
        )
        return await _state_response(session, site, row, project, licensing)


async def svc_final_approval(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
) -> NsoStateResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        project = await _fetch_project(session, site_id=site.id)
        licensing = await _fetch_licensing(session, site_id=site.id)
        row = await _fetch_nso_or_create(session, site=site)
        if not _stage_three_complete(row):
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Complete Stage 3 before final NSO approval.")
        row.nso_status = "complete"
        row.current_stage = "done"
        row.final_approved_at = row.final_approved_at or datetime.now(timezone.utc)
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="nso_final_approved",
            detail="NSO final approval complete.",
        )
        # Kick off the post-NSO launch approval chain. Isolated in its own
        # try/except (and a SAVEPOINT inside the service) so a launch_approvals
        # insert failure can NEVER roll back the NSO completion we just made (#141).
        try:
            await svc_create_launch_approval(session, site=site, tenant_id=tenant_id)
        except Exception:
            logger.exception(
                "Could not create launch_approval for site %s — NSO approval still committed", site.id,
            )
        return await _state_response(session, site, row, project, licensing)
