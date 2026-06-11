"""NSO service.

NSO opens after Finance / CA is approved, then advances as Project milestones
unlock. The module owns only NSO readiness fields; Finance and Project remain
the source of truth for the external triggers.
"""
from __future__ import annotations

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


LICENSE_FIELDS = (
    "fssai_status",
    "health_trade_status",
    "shops_estab_status",
    "fire_noc_status",
    "storage_license_status",
)


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


def _stage_two_complete(row: models.NsoReview) -> bool:
    return all(getattr(row, field) == "done" for field in LICENSE_FIELDS)


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


def _stage_three_unlocked(row: models.NsoReview, project: Optional[models.ProjectReview]) -> bool:
    return _stage_two_complete(row) and _project_done(project)


def _compute_stage(row: models.NsoReview, project: Optional[models.ProjectReview]) -> str:
    if row.nso_status == "complete":
        return "done"
    if not _stage_one_complete(row):
        return "stage_one"
    if not _stage_two_unlocked(row, project) or not _stage_two_complete(row):
        return "stage_two"
    if not _stage_three_unlocked(row, project) or not _stage_three_complete(row):
        return "stage_three"
    return "final"


def _display_rollups(
    row: models.NsoReview, project: Optional[models.ProjectReview],
) -> tuple[str, str]:
    """Display-time (nso_status, current_stage) WITHOUT mutating the row.

    Read paths (queue / history / detail GET) must never write — `_sync_rollups`
    on a GET turned every queue load into N potential UPDATEs (and the
    row-creation variant into N INSERTs), which is what made /nso/queue take
    seconds. Rollup persistence belongs to the stage-save write paths only.
    """
    current_stage = _compute_stage(row, project)
    if row.nso_status == "complete":
        nso_status = "complete"
    else:
        nso_status = "in_progress" if current_stage != "stage_one" or _stage_one_complete(row) else "pending"
    return nso_status, current_stage


def _sync_rollups(row: models.NsoReview, project: Optional[models.ProjectReview]) -> None:
    now = datetime.now(timezone.utc)
    if _stage_one_complete(row) and row.stage_one_completed_at is None:
        row.stage_one_completed_at = now
    if _stage_two_complete(row) and row.stage_two_completed_at is None:
        row.stage_two_completed_at = now
    if _stage_three_complete(row) and row.stage_three_completed_at is None:
        row.stage_three_completed_at = now
    row.current_stage = _compute_stage(row, project)
    if row.nso_status != "complete":
        row.nso_status = "in_progress" if row.current_stage != "stage_one" or _stage_one_complete(row) else "pending"


def _triggers(site: models.Site, row: models.NsoReview, project: Optional[models.ProjectReview]) -> list[NsoTriggerState]:
    trigger1 = _trigger_one_unlocked(site)
    stage1_done = _stage_one_complete(row)
    project_init = _project_init_unlocked(project)
    project_done = _project_done(project)
    stage2_done = _stage_two_complete(row)
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
            unlocked=stage2_done and project_done,
            complete=_stage_three_complete(row),
            reason=(
                None if stage2_done and project_done
                else "Complete license checks and wait for Project completion."
            ),
        ),
    ]


async def _queue_item(
    session: AsyncSession,
    site: models.Site,
    row: Optional[models.NsoReview],
    project: Optional[models.ProjectReview],
) -> NsoQueueItem:
    nso_status = row.nso_status if row else "pending"
    current_stage = row.current_stage if row else "stage_one"
    if row is not None:
        nso_status, current_stage = _display_rollups(row, project)
    next_action = "Open Stage 1"
    if row is not None:
        if nso_status == "complete":
            next_action = "Complete"
        elif current_stage == "stage_two":
            next_action = "Open license checks"
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
) -> NsoStateResponse:
    nso_status, current_stage = _display_rollups(row, project)
    snapshot = await _property_snapshot(session, site=site)
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
        triggers=_triggers(site, row, project),
        property_snapshot=snapshot,
        property_details=row.property_details,
        communication_floated=row.communication_floated,
        fssai_status=row.fssai_status,
        health_trade_status=row.health_trade_status,
        shops_estab_status=row.shops_estab_status,
        fire_noc_status=row.fire_noc_status,
        storage_license_status=row.storage_license_status,
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


async def svc_nso_queue(session: AsyncSession, *, tenant_id: str | UUID) -> NsoQueueResponse:
    async with transaction(session):
        sites = (await session.execute(
            select(models.Site)
            .where(
                models.Site.tenant_id == tenant_id,
                models.Site.finance_status == "approved",
                models.Site.ca_code.is_not(None),
            )
            .order_by(models.Site.updated_at.asc())
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
        if site_ids:
            nso_rows = {r.site_id: r for r in (await session.execute(
                select(models.NsoReview).where(models.NsoReview.site_id.in_(site_ids))
            )).scalars()}
            projects = {p.site_id: p for p in (await session.execute(
                select(models.ProjectReview).where(models.ProjectReview.site_id.in_(site_ids))
            )).scalars()}
        items: list[NsoQueueItem] = []
        for site in sites:
            items.append(await _queue_item(session, site, nso_rows.get(site.id), projects.get(site.id)))
        return NsoQueueResponse(items=items, total=len(items))


async def svc_nso_history(
    session: AsyncSession, *, tenant_id: str | UUID, status_filter: str = "all",
) -> NsoHistoryResponse:
    async with transaction(session):
        stmt = (
            select(models.Site, models.NsoReview, models.ProjectReview)
            .outerjoin(models.NsoReview, models.NsoReview.site_id == models.Site.id)
            .outerjoin(models.ProjectReview, models.ProjectReview.site_id == models.Site.id)
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
        items = [await _queue_item(session, site, row, project) for (site, row, project) in rows]
        return NsoHistoryResponse(items=items, total=len(items))


async def svc_get_nso(
    session: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID, create: bool = True,
) -> NsoStateResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        project = await _fetch_project(session, site_id=site.id)
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
        return await _state_response(session, site, row, project)


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
        row = await _fetch_nso_or_create(session, site=site)
        snapshot = await _property_snapshot(session, site=site)
        if body.property_details and body.property_details.strip():
            row.property_details = body.property_details.strip()
        elif not (row.property_details or "").strip():
            row.property_details = _property_summary(snapshot)
        row.communication_floated = body.communication_floated
        _sync_rollups(row, project)
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="nso_stage_one_saved",
            detail="Property details and communication status captured.",
        )
        return await _state_response(session, site, row, project)


async def svc_save_stage_two(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: NsoStageTwoRequest,
) -> NsoStateResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        project = await _fetch_project(session, site_id=site.id)
        row = await _fetch_nso_or_create(session, site=site)
        if not _stage_two_unlocked(row, project):
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="NSO Stage 2 is locked until Stage 1 and Project initiation are complete.")
        for field in LICENSE_FIELDS:
            setattr(row, field, getattr(body, field))
        _sync_rollups(row, project)
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="nso_stage_two_saved",
            detail="License status checklist captured.",
        )
        return await _state_response(session, site, row, project)


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
        row = await _fetch_nso_or_create(session, site=site)
        if not _stage_three_unlocked(row, project):
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="NSO Stage 3 is locked until license checks and Project completion are complete.")
        row.dry_stock_order_status = body.dry_stock_order_status
        row.online_delivery_status = body.online_delivery_status
        row.handover_checklist_signed = body.handover_checklist_signed
        row.launch_date = body.launch_date
        row.launch_ready = body.launch_ready
        row.final_approval_signoff_1 = body.final_approval_signoff_1
        row.final_approval_signoff_2 = body.final_approval_signoff_2
        _sync_rollups(row, project)
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="nso_stage_three_saved",
            detail="Launch readiness checklist captured.",
        )
        return await _state_response(session, site, row, project)


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
        # Kick off the post-NSO launch approval chain.
        await svc_create_launch_approval(session, site=site, tenant_id=tenant_id)
        return await _state_response(session, site, row, project)
