"""BD service — real SQLAlchemy queries for every pipeline action.

Every public `svc_*` function:
1. Opens (or reuses) a transaction.
2. Reads the current Site row, scoped to tenant.
3. Validates the state transition via `assert_transition`.
4. Mutates the row.
5. Writes ONE OR MORE audit_log rows (one per changed field for
   `pipeline_field_edited` events).
6. Writes notification_outbox rows for downstream delivery.
7. Commits.

Callers (`bd.py`, `sites.py`) are thin — they pass the AsyncSession plus the
current_user dict and let this layer enforce the rules.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.db.session import transaction
from app.domain.schemas.common import OkResponse
from app.domain.schemas.site import SiteResponse
from app.domain.state_machine import SiteStatus, assert_transition
from app.services._common import (
    fetch_site_or_404,
    fetch_user_name,
    make_site_code,
    site_to_response,
)
from app.services.audit_service import diff_and_log_pipeline_fields, write_audit_event
from app.services.notification_service import (
    enqueue as notify_enqueue,
    recipients_for_site_owner,
    recipients_for_supervisors,
)


# ── Create draft ──────────────────────────────────────────────────────────

async def svc_create_draft(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    name: str,
    city: str,
    visit_date,
    model: str | None = None,
    spoc_name: str | None = None,
    google_pin: str | None = None,
    expected_rent: float | None = None,
    rent_type: str | None = None,
) -> SiteResponse:
    """Create a pipeline draft (executive). One canonical implementation used
    by both `POST /api/bd/drafts` and `POST /api/sites`."""
    async with transaction(session):
        site = models.Site(
            tenant_id=tenant_id,
            code=make_site_code(city),
            status=SiteStatus.DRAFT_SUBMITTED.value,
            name=name,
            city=city,
            visit_date=visit_date,
            model=model,
            spoc_name=spoc_name,
            google_maps_pin=google_pin,
            expected_rent=expected_rent,
            rent_type=rent_type,
            rent_set_at=datetime.now(timezone.utc) if expected_rent is not None else None,
            submitted_by=actor["sub"],
        )
        session.add(site)
        await session.flush()

        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor["name"],
            action="create_draft",
            from_status=None,
            to_status=SiteStatus.DRAFT_SUBMITTED.value,
        )
        recipients = await recipients_for_supervisors(session, tenant_id=tenant_id, city=city)
        await notify_enqueue(
            session,
            tenant_id=tenant_id,
            event="draft_submitted",
            recipient_ids=recipients,
            site_id=site.id,
            channels=("email", "slack", "in_app"),
            payload={"site_id": str(site.id), "site_name": name, "city": city},
        )

    return site_to_response(site, created_by_name=actor["name"])


# ── Shortlist ─────────────────────────────────────────────────────────────

async def svc_shortlist_draft(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
) -> SiteResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        assert_transition(SiteStatus(site.status), SiteStatus.SHORTLISTED)
        site.status = SiteStatus.SHORTLISTED.value
        site.shortlisted_at = datetime.now(timezone.utc)
        site.supervisor_id = actor["sub"]

        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor["name"],
            action="shortlist",
            from_status=SiteStatus.DRAFT_SUBMITTED.value,
            to_status=SiteStatus.SHORTLISTED.value,
        )
        owners = await recipients_for_site_owner(session, site=site)
        await notify_enqueue(
            session, tenant_id=tenant_id, event="draft_shortlisted",
            recipient_ids=owners, site_id=site.id,
            channels=("email", "in_app"),
            payload={"site_id": str(site.id)},
        )
    created_by_name = await fetch_user_name(session, site.submitted_by)
    return site_to_response(site, created_by_name=created_by_name)


# ── Save partial details ──────────────────────────────────────────────────

async def svc_save_details(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    details: dict,
) -> OkResponse:
    """Partial save. Promotes the five pipeline-stage fields onto the site row,
    diff-logs each change, and upserts the site_details row with the remaining
    fields. No status transition."""
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        before = {
            "model": site.model,
            "spoc_name": site.spoc_name,
            "google_pin": site.google_maps_pin,
            "expected_rent": float(site.expected_rent) if site.expected_rent is not None else None,
            "rent_type": site.rent_type,
        }
        # Normalise incoming keys to the audit key shape
        incoming = {
            "model": details.get("model"),
            "spoc_name": details.get("spoc_name"),
            "google_pin": details.get("google_pin"),
            "expected_rent": _to_float(details.get("rent")),
            "rent_type": details.get("rent_type"),
        }
        await diff_and_log_pipeline_fields(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor["name"],
            before=before,
            after=incoming,
        )
        # Apply pipeline-field updates onto the site row
        for k, v in incoming.items():
            if v is None or v == "":
                continue
            if k == "google_pin":
                site.google_maps_pin = v
            else:
                setattr(site, k, v)
        if incoming.get("expected_rent") is not None:
            site.rent_set_at = datetime.now(timezone.utc)

        await _upsert_site_details(session, tenant_id=tenant_id, site_id=site.id, details=details)

    return OkResponse(message=f"Details draft saved for site {site_id}")


# ── Submit details for review ─────────────────────────────────────────────

async def svc_submit_details(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    details: dict | None = None,
) -> SiteResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        assert_transition(SiteStatus(site.status), SiteStatus.DETAILS_SUBMITTED)
        if details:
            before = {
                "model": site.model, "spoc_name": site.spoc_name,
                "google_pin": site.google_maps_pin,
                "expected_rent": float(site.expected_rent) if site.expected_rent is not None else None,
                "rent_type": site.rent_type,
            }
            incoming = {
                "model": details.get("model"), "spoc_name": details.get("spoc_name"),
                "google_pin": details.get("google_pin"),
                "expected_rent": _to_float(details.get("rent")),
                "rent_type": details.get("rent_type"),
            }
            await diff_and_log_pipeline_fields(
                session, tenant_id=tenant_id, site_id=site.id,
                actor_id=actor["sub"], actor_name=actor["name"],
                before=before, after=incoming,
            )
            for k, v in incoming.items():
                if v is None or v == "":
                    continue
                if k == "google_pin":
                    site.google_maps_pin = v
                else:
                    setattr(site, k, v)
            await _upsert_site_details(session, tenant_id=tenant_id, site_id=site.id, details=details)

        site.status = SiteStatus.DETAILS_SUBMITTED.value
        site.details_submitted_at = datetime.now(timezone.utc)

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="submit_details_for_review",
            from_status=SiteStatus.SHORTLISTED.value,
            to_status=SiteStatus.DETAILS_SUBMITTED.value,
        )
        recipients = await recipients_for_supervisors(session, tenant_id=tenant_id, city=site.city)
        await notify_enqueue(
            session, tenant_id=tenant_id, event="details_submitted_for_review",
            recipient_ids=recipients, site_id=site.id,
            channels=("email", "slack", "in_app"),
            payload={"site_id": str(site.id)},
        )
    created_by_name = await fetch_user_name(session, site.submitted_by)
    return site_to_response(site, created_by_name=created_by_name)


# ── Approve ───────────────────────────────────────────────────────────────

async def svc_approve_shortlist(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    expected_loi_days: int,
) -> SiteResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        assert_transition(SiteStatus(site.status), SiteStatus.APPROVED)
        site.status = SiteStatus.APPROVED.value
        site.approved_at = datetime.now(timezone.utc)

        # Persist a row in `approvals` so the supervisor decision has its own
        # auditable record (previously the table was defined but unused).
        session.add(models.Approval(
            tenant_id=tenant_id,
            site_id=site.id,
            approver_id=actor["sub"],
            status="approved",
            expected_loi_days=expected_loi_days,
            decided_at=datetime.now(timezone.utc),
        ))

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="approve_details",
            from_status=SiteStatus.DETAILS_SUBMITTED.value,
            to_status=SiteStatus.APPROVED.value,
            detail=f"expected_loi_days={expected_loi_days}",
        )
        owners = await recipients_for_site_owner(session, site=site)
        await notify_enqueue(
            session, tenant_id=tenant_id, event="site_approved",
            recipient_ids=owners, site_id=site.id,
            channels=("email", "in_app"),
            payload={"site_id": str(site.id), "expected_loi_days": expected_loi_days},
        )
    created_by_name = await fetch_user_name(session, site.submitted_by)
    return site_to_response(site, created_by_name=created_by_name)


# ── Push to payments ──────────────────────────────────────────────────────

async def svc_push_to_payments(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict, site_id: str | UUID,
) -> OkResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        assert_transition(SiteStatus(site.status), SiteStatus.PUSHED_TO_PAYMENTS)
        site.status = SiteStatus.PUSHED_TO_PAYMENTS.value
        site.pushed_to_payments_at = datetime.now(timezone.utc)
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="push_to_payments",
            from_status=SiteStatus.LOI_UPLOADED.value,
            to_status=SiteStatus.PUSHED_TO_PAYMENTS.value,
        )
        owners = await recipients_for_site_owner(session, site=site)
        await notify_enqueue(
            session, tenant_id=tenant_id, event="site_pushed_to_payments",
            recipient_ids=owners, site_id=site.id,
            channels=("email", "slack", "in_app"),
            payload={"site_id": str(site.id)},
        )
    return OkResponse(message=f"Site {site_id} pushed to Payments")


# ── Reject ────────────────────────────────────────────────────────────────

async def svc_reject_site(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict,
    site_id: str | UUID, reasons: list[str], comment: Optional[str] = None,
) -> OkResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        assert_transition(SiteStatus(site.status), SiteStatus.REJECTED)
        site.status = SiteStatus.REJECTED.value
        site.rejected_at = datetime.now(timezone.utc)
        site.rejection_reason = " | ".join(reasons) + (f" — {comment}" if comment else "")
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="reject",
            to_status=SiteStatus.REJECTED.value,
            detail=site.rejection_reason,
        )
        owners = await recipients_for_site_owner(session, site=site)
        await notify_enqueue(
            session, tenant_id=tenant_id, event="draft_rejected",
            recipient_ids=owners, site_id=site.id,
            channels=("email", "in_app"),
            payload={"site_id": str(site.id), "reasons": reasons},
        )
    return OkResponse(message=f"Site {site_id} rejected")


# ── Archive ───────────────────────────────────────────────────────────────

async def svc_archive_site(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict,
    site_id: str | UUID, note: Optional[str] = None,
) -> OkResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        assert_transition(SiteStatus(site.status), SiteStatus.ARCHIVED)
        site.status = SiteStatus.ARCHIVED.value
        site.archived_at = datetime.now(timezone.utc)
        site.archive_note = note
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="archive", to_status=SiteStatus.ARCHIVED.value, detail=note,
        )
    return OkResponse(message=f"Site {site_id} archived")


# ── Reassign ──────────────────────────────────────────────────────────────

async def svc_reassign_site(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict,
    site_id: str | UUID, new_owner_id: str | UUID,
) -> OkResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        old_owner_id = site.assigned_to
        site.assigned_to = new_owner_id
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="reassign_site",
            field_name="assigned_to",
            from_value=str(old_owner_id) if old_owner_id else None,
            to_value=str(new_owner_id),
            detail=f"reassigned to {new_owner_id}",
        )
        await notify_enqueue(
            session, tenant_id=tenant_id, event="site_reassigned",
            recipient_ids=[new_owner_id], site_id=site.id,
            channels=("email", "in_app"),
            payload={"site_id": str(site.id)},
        )
    return OkResponse(message=f"Site {site_id} reassigned")


# ── Internal helpers ──────────────────────────────────────────────────────

def _to_float(v) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


_SITE_DETAIL_KEY_MAP = {
    "score": "score",
    "est_sales": "estimated_monthly_sales",
    "nearest_starbucks": "nearest_starbucks_m",
    "nearest_twc": "nearest_twc_m",
    "carpet": "carpet_area_sqft",
    "cam": "cam_charges",
    "escalation": "escalation_pct",
    "rent_free_days": "rent_free_days",
    "cadex": "capex",
    "deposit": "security_deposit",
    "brokerage": "brokerage",
    "lockin": "lock_in_months",
    "tenure": "tenure_months",
    "rent_type": "rent_type",
}


async def _upsert_site_details(
    session: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID, details: dict,
) -> None:
    """Upsert site_details with whatever fields the form supplied. We do NOT
    write `fixed_rent_amt` — that column is tombstoned; rent lives on
    `sites.expected_rent`."""
    from sqlalchemy import select

    stmt = select(models.SiteDetail).where(models.SiteDetail.site_id == site_id)
    row = (await session.execute(stmt)).scalar_one_or_none()
    payload: dict = {}
    for src, dst in _SITE_DETAIL_KEY_MAP.items():
        val = details.get(src)
        if val is None or val == "":
            continue
        payload[dst] = val

    if row is None:
        session.add(models.SiteDetail(tenant_id=tenant_id, site_id=site_id, **payload))
    else:
        for k, v in payload.items():
            setattr(row, k, v)
    await session.flush()
