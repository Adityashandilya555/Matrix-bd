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


# ── Authorisation guards ──────────────────────────────────────────────────
#
# Two cross-cutting rules every state-changing action goes through.
#
#   1. City scope (sub_supervisor only). Sub-supervisors own a city. They are
#      *not* allowed to act on a site that lives in another city. Supervisors
#      have no city restriction. Executives reach these paths only through
#      their own submissions and so are implicitly already in-scope.
#
#   2. Self-approval. Whoever submitted the draft cannot also be the one who
#      approves / rejects it. The supervisor's own drafts skip approval
#      entirely via the auto-promote rule (see Todo #10) — they never reach
#      these guards as a self-approval. This is purely defensive.
#

def _city_eq(a: str | None, b: str | None) -> bool:
    return (a or "").strip().lower() == (b or "").strip().lower()


def _assert_actor_can_act_on_site(actor: dict, site: models.Site) -> None:
    """City-scope guard. Raises 403 if sub_supervisor is acting outside their
    assigned city. Supervisor / executive pass through untouched."""
    if (actor.get("role") or "").lower() != "sub_supervisor":
        return
    actor_city = actor.get("city")
    if not actor_city:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Sub-supervisor has no assigned city. Ask the supervisor to set one on /team.",
        )
    if not _city_eq(actor_city, site.city):
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail=(
                f"You can only act on sites in your assigned city "
                f"({actor_city}). This site is in {site.city}."
            ),
        )


def _assert_not_self_approval(actor: dict, site: models.Site) -> None:
    """Self-approval guard. The submitter cannot also be the approver/rejecter
    of the same draft. A supervisor draft never reaches here because it
    auto-promotes — see svc_create_draft."""
    if str(site.submitted_by) == str(actor["sub"]):
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="You cannot approve or reject a draft you submitted.",
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
    """Create a pipeline draft. One canonical implementation used by both
    `POST /api/bd/drafts` and `POST /api/sites`.

    Auto-promote rule (Todo #10): when the *supervisor* submits the draft
    themselves we skip the queue and put it straight into SHORTLISTED with
    themselves as the supervising party. The product spec is explicit:
    supervisor drafts must not need their own approval.
    """
    is_supervisor = (actor.get("role") or "").lower() == "supervisor"
    now = datetime.now(timezone.utc)
    initial_status = SiteStatus.SHORTLISTED if is_supervisor else SiteStatus.DRAFT_SUBMITTED

    async with transaction(session):
        site = models.Site(
            tenant_id=tenant_id,
            code=make_site_code(city),
            status=initial_status.value,
            name=name,
            city=city,
            visit_date=visit_date,
            model=model,
            spoc_name=spoc_name,
            google_maps_pin=google_pin,
            expected_rent=expected_rent,
            rent_type=rent_type,
            rent_set_at=now if expected_rent is not None else None,
            submitted_by=actor["sub"],
            shortlisted_at=now if is_supervisor else None,
            supervisor_id=actor["sub"] if is_supervisor else None,
        )
        session.add(site)
        await session.flush()

        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor["name"],
            action="create_draft_auto_shortlist" if is_supervisor else "create_draft",
            from_status=None,
            to_status=initial_status.value,
            detail="supervisor auto-promote" if is_supervisor else None,
        )
        # Supervisors don't need to notify themselves; for executives the
        # supervisor cohort gets the email/slack ping.
        if not is_supervisor:
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
        _assert_actor_can_act_on_site(actor, site)
        _assert_not_self_approval(actor, site)
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
        _assert_actor_can_act_on_site(actor, site)
        _assert_not_self_approval(actor, site)
        assert_transition(SiteStatus(site.status), SiteStatus.APPROVED)
        approved_at = datetime.now(timezone.utc)
        site.status = SiteStatus.APPROVED.value
        site.approved_at = approved_at

        # Pre-compute the LOI deadline. The product spec calls for a soft
        # countdown / highlight on overdue sites — the cheapest source of
        # truth is a stored DATE column on the approval row rather than
        # recomputing in every read. Stored as DATE (not timestamp) because
        # business deadlines are end-of-day in local time, not a precise
        # instant.
        from datetime import timedelta
        loi_deadline = (approved_at + timedelta(days=int(expected_loi_days))).date()

        session.add(models.Approval(
            tenant_id=tenant_id,
            site_id=site.id,
            approver_id=actor["sub"],
            status="approved",
            expected_loi_days=expected_loi_days,
            loi_deadline=loi_deadline,
            decided_at=approved_at,
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
        _assert_actor_can_act_on_site(actor, site)
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
        _assert_actor_can_act_on_site(actor, site)
        _assert_not_self_approval(actor, site)
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
        _assert_actor_can_act_on_site(actor, site)
        # Archive note is mandatory — see Todo #9. Per the product spec every
        # archived site must carry a reason so the Archive tab is browsable.
        clean_note = (note or "").strip()
        if not clean_note:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="An archive note is required so the archived site stays browsable.",
            )
        assert_transition(SiteStatus(site.status), SiteStatus.ARCHIVED)
        # Remember the status we came from so Revive (Todo #11) can restore
        # the site to its prior stage rather than dumping it into drafts.
        site.archived_from_status = site.status
        site.status = SiteStatus.ARCHIVED.value
        site.archived_at = datetime.now(timezone.utc)
        site.archive_note = clean_note
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="archive", to_status=SiteStatus.ARCHIVED.value,
            detail=f"from={site.archived_from_status} note={clean_note}",
        )
    return OkResponse(message=f"Site {site_id} archived")


# ── Revive (un-archive) ───────────────────────────────────────────────────

async def svc_revive_site(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict,
    site_id: str | UUID, note: Optional[str] = None,
) -> OkResponse:
    """Revive an archived site back to the stage it was at when archived.

    Only the supervisor can revive — sub-supervisors and executives must ask
    for it. The site's `archived_from_status` field is the source of truth
    for where to put it back. If it's missing (older archives that predate
    the column), we fall back to draft_submitted so the site is at least
    re-visible in the pipeline.
    """
    if (actor.get("role") or "").lower() != "supervisor":
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Only the supervisor can revive an archived site.",
        )
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        if site.status != SiteStatus.ARCHIVED.value:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail=f"Site is not archived (current status={site.status}).",
            )
        prev = site.archived_from_status or SiteStatus.DRAFT_SUBMITTED.value
        site.status = prev
        site.archived_at = None
        site.archived_from_status = None
        # Keep the archive_note as historical context — Revive doesn't erase
        # the reason a site was once archived.
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="revive",
            from_status=SiteStatus.ARCHIVED.value, to_status=prev,
            detail=f"reason={(note or '').strip() or 'n/a'}",
        )
        owners = await recipients_for_site_owner(session, site=site)
        await notify_enqueue(
            session, tenant_id=tenant_id, event="site_revived",
            recipient_ids=owners, site_id=site.id,
            channels=("email", "in_app"),
            payload={"site_id": str(site.id), "revived_to": prev},
        )
    return OkResponse(message=f"Site {site_id} revived to {prev}")


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
