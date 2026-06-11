"""Launch Approval service.

Manages the post-NSO multi-step sign-off chain:
  pending → admin_approved → bd_confirmed → supervisor_approved
  → super_admin_approved → launched (sites.is_launched = true)

Called from:
  - nso_service.svc_final_approval  (creates the initial launch_approvals row)
  - launch router endpoints         (advance through the chain)
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.db.session import transaction
from app.domain.schemas.launch import (
    LaunchApprovalResponse,
    LaunchFieldsRequest,
    LaunchQueueItem,
    LaunchQueueResponse,
)
from app.services._common import fetch_site_or_404, fetch_user_name
from app.services.audit_service import write_audit_event


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _fetch_approval(
    session: AsyncSession,
    *,
    site_id: str | UUID,
    tenant_id: str | UUID,
    required: bool = True,
) -> Optional[models.LaunchApproval]:
    row = (await session.execute(
        select(models.LaunchApproval).where(
            models.LaunchApproval.site_id == site_id,
            models.LaunchApproval.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if row is None and required:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Launch approval record not found for this site.",
        )
    return row


async def _build_response(
    session: AsyncSession,
    *,
    row: models.LaunchApproval,
    site: models.Site,
) -> LaunchApprovalResponse:
    async def name(uid: Optional[UUID]) -> Optional[str]:
        return await fetch_user_name(session, user_id=uid) if uid else None

    return LaunchApprovalResponse(
        site_id=str(site.id),
        site_code=site.code,
        site_name=site.name,
        city=site.city,
        tenant_id=str(row.tenant_id),
        status=row.status,
        # Commercial snapshot
        rent_type=row.rent_type,
        fixed_rent_amt=float(row.fixed_rent_amt) if row.fixed_rent_amt is not None else None,
        expected_rent=float(row.expected_rent) if row.expected_rent is not None else None,
        rev_share_pct=float(row.rev_share_pct) if row.rev_share_pct is not None else None,
        escalation_pct=float(row.escalation_pct) if row.escalation_pct is not None else None,
        escalation_date=row.escalation_date,
        expected_escalation_years=row.expected_escalation_years,
        cam_charges=float(row.cam_charges) if row.cam_charges is not None else None,
        security_deposit=float(row.security_deposit) if row.security_deposit is not None else None,
        brokerage=float(row.brokerage) if row.brokerage is not None else None,
        lock_in_months=row.lock_in_months,
        tenure_months=row.tenure_months,
        rent_free_days=row.rent_free_days,
        carpet_area_sqft=float(row.carpet_area_sqft) if row.carpet_area_sqft is not None else None,
        estimated_monthly_sales=float(row.estimated_monthly_sales) if row.estimated_monthly_sales is not None else None,
        capex=float(row.capex) if row.capex is not None else None,
        score=float(row.score) if row.score is not None else None,
        notes=row.notes,
        # Approval chain
        admin_approved_at=row.admin_approved_at,
        admin_approved_by_name=await name(row.admin_approved_by),
        bd_confirmed_at=row.bd_confirmed_at,
        bd_confirmed_by_name=await name(row.bd_confirmed_by),
        supervisor_approved_at=row.supervisor_approved_at,
        supervisor_approved_by_name=await name(row.supervisor_approved_by),
        super_admin_approved_at=row.super_admin_approved_at,
        super_admin_approved_by_name=await name(row.super_admin_approved_by),
        launched_at=row.launched_at,
        launched_by_name=await name(row.launched_by),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _num(v) -> Optional[float]:
    return float(v) if v is not None else None


# ── Create (called by NSO service on final approval) ──────────────────────────

async def svc_create_launch_approval(
    session: AsyncSession,
    *,
    site: models.Site,
    tenant_id: str | UUID,
) -> models.LaunchApproval:
    """Create a launch_approvals row pre-populated from site + site_details.
    Safe to call multiple times — skips creation if a row already exists.
    """
    existing = await _fetch_approval(session, site_id=site.id, tenant_id=tenant_id, required=False)
    if existing:
        return existing

    # Pull site_details for the commercial snapshot
    detail = (await session.execute(
        select(models.SiteDetail).where(models.SiteDetail.site_id == site.id)
    )).scalar_one_or_none()

    row = models.LaunchApproval(
        site_id=site.id,
        tenant_id=site.tenant_id,
        status="pending",
        # Pre-populate from site
        rent_type=site.rent_type,
        expected_rent=_num(site.expected_rent),
        escalation_pct=_num(site.expected_escalation_pct),
        expected_escalation_years=site.expected_escalation_years,
        rev_share_pct=_num(site.expected_revshare_pct),
    )

    if detail:
        row.fixed_rent_amt = _num(detail.fixed_rent_amt)
        row.rev_share_pct = row.rev_share_pct or _num(detail.rev_share_pct)
        row.escalation_pct = row.escalation_pct or _num(detail.escalation_pct)
        row.escalation_date = detail.escalation_date
        row.cam_charges = _num(detail.cam_charges)
        row.security_deposit = _num(detail.security_deposit)
        row.brokerage = _num(detail.brokerage)
        row.lock_in_months = detail.lock_in_months
        row.tenure_months = detail.tenure_months
        row.rent_free_days = detail.rent_free_days
        row.carpet_area_sqft = _num(detail.carpet_area_sqft)
        row.estimated_monthly_sales = _num(detail.estimated_monthly_sales)
        row.capex = _num(detail.capex)
        row.score = _num(detail.score)

    session.add(row)
    return row


# ── Queue fetchers ─────────────────────────────────────────────────────────────

async def svc_get_launch_queue(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    status_filter: Optional[str] = None,
) -> LaunchQueueResponse:
    """Returns all launch approval rows for the tenant, optionally filtered by status."""
    q = select(models.LaunchApproval, models.Site).join(
        models.Site, models.Site.id == models.LaunchApproval.site_id
    ).where(models.LaunchApproval.tenant_id == tenant_id)

    if status_filter:
        statuses = [s.strip() for s in status_filter.split(",")]
        q = q.where(models.LaunchApproval.status.in_(statuses))

    rows = (await session.execute(q)).all()

    items = [
        LaunchQueueItem(
            site_id=str(site.id),
            site_code=site.code,
            site_name=site.name,
            city=site.city,
            status=approval.status,
            updated_at=approval.updated_at,
            admin_approved_at=approval.admin_approved_at,
            bd_confirmed_at=approval.bd_confirmed_at,
            supervisor_approved_at=approval.supervisor_approved_at,
            super_admin_approved_at=approval.super_admin_approved_at,
            launched_at=approval.launched_at,
        )
        for approval, site in rows
    ]
    return LaunchQueueResponse(items=items, total=len(items))


async def svc_get_approval(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    site_id: str | UUID,
) -> LaunchApprovalResponse:
    site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
    row = await _fetch_approval(session, site_id=site.id, tenant_id=tenant_id)
    return await _build_response(session, row=row, site=site)


# ── Field save (admin edits before approving) ──────────────────────────────────

async def svc_save_fields(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: LaunchFieldsRequest,
) -> LaunchApprovalResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        row = await _fetch_approval(session, site_id=site.id, tenant_id=tenant_id)

        if row.status not in ("pending", "admin_approved"):
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Fields can only be edited before BD confirms.",
            )

        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(row, field, value)

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="launch_fields_saved",
            detail="Launch approval commercial fields updated.",
        )
        return await _build_response(session, row=row, site=site)


# ── Approval chain steps ───────────────────────────────────────────────────────

async def svc_admin_approve(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
) -> LaunchApprovalResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        row = await _fetch_approval(session, site_id=site.id, tenant_id=tenant_id)

        if row.status != "pending":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Cannot admin-approve from status '{row.status}'. Expected 'pending'.",
            )
        row.status = "admin_approved"
        row.admin_approved_at = datetime.now(timezone.utc)
        row.admin_approved_by = UUID(actor["sub"])

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="launch_admin_approved",
            detail="Admin approved launch fields.",
        )
        return await _build_response(session, row=row, site=site)


async def svc_bd_confirm(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
) -> LaunchApprovalResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        row = await _fetch_approval(session, site_id=site.id, tenant_id=tenant_id)

        if row.status != "admin_approved":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Cannot confirm from status '{row.status}'. Expected 'admin_approved'.",
            )
        row.status = "bd_confirmed"
        row.bd_confirmed_at = datetime.now(timezone.utc)
        row.bd_confirmed_by = UUID(actor["sub"])

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="launch_bd_confirmed",
            detail="BD confirmed the launch commercial terms.",
        )
        return await _build_response(session, row=row, site=site)


async def svc_supervisor_approve(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
) -> LaunchApprovalResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        row = await _fetch_approval(session, site_id=site.id, tenant_id=tenant_id)

        if row.status != "bd_confirmed":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Cannot supervisor-approve from status '{row.status}'. Expected 'bd_confirmed'.",
            )
        row.status = "supervisor_approved"
        row.supervisor_approved_at = datetime.now(timezone.utc)
        row.supervisor_approved_by = UUID(actor["sub"])

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="launch_supervisor_approved",
            detail="Supervisor approved for launch.",
        )
        return await _build_response(session, row=row, site=site)


async def svc_super_admin_approve(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
) -> LaunchApprovalResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        row = await _fetch_approval(session, site_id=site.id, tenant_id=tenant_id)

        if row.status != "supervisor_approved":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Cannot super-admin-approve from status '{row.status}'. Expected 'supervisor_approved'.",
            )
        row.status = "super_admin_approved"
        row.super_admin_approved_at = datetime.now(timezone.utc)
        row.super_admin_approved_by = UUID(actor["sub"])

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="launch_super_admin_approved",
            detail="Super admin approved. Launch button is now unlocked.",
        )
        return await _build_response(session, row=row, site=site)


async def svc_launch(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
) -> LaunchApprovalResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        row = await _fetch_approval(session, site_id=site.id, tenant_id=tenant_id)

        if row.status != "super_admin_approved":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Cannot launch from status '{row.status}'. Requires super admin approval first.",
            )

        now = datetime.now(timezone.utc)
        row.status = "launched"
        row.launched_at = now
        row.launched_by = UUID(actor["sub"])

        # Flip the cross-module flag on the parent sites row
        site.is_launched = True
        site.launched_at = now

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="site_launched",
            detail="Site launched. is_launched flag set across all modules.",
        )
        return await _build_response(session, row=row, site=site)
