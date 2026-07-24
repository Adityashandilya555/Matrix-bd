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
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.db.session import transaction
from app.domain.schemas.common import OkResponse
from app.domain.schemas.site import SiteResponse
from app.domain.state_machine import SiteStatus, assert_transition
from app.services._common import (
    actor_can_supervise,
    compute_unseen_supervisor_edits,
    fetch_site_for_update_or_404,
    fetch_user_name,
    make_site_code,
    site_to_response,
)
from app.services.audit_service import (
    EXEC_VIEWED_ACTION,
    SUPERVISOR_EDIT_ACTION,
    diff_and_log_pipeline_fields,
    write_audit_event,
)
from app.services.notification_service import (
    enqueue as notify_enqueue,
    recipients_for_legal_supervisors,
    recipients_for_site_owner,
    recipients_for_supervisors,
)


# ── Authorisation guards ──────────────────────────────────────────────────
#
# Self-approval rule: segregation of duties for whoever *approves* a draft.
# Supervisors are the approval authority — they may act on their own drafts,
# including a draft they created while acting as an executive via role-switch
# (X-Override-Role), where submitted_by == their own user id. A caller with no
# supervisor authority cannot approve their own submission. Every approval
# route already requires the supervisor role (see routers/bd.py and the
# _supervisor_only set in routers/sites.py), so this guard is defence-in-depth.


def _assert_not_self_approval(actor: dict, site: models.Site) -> None:
    """Block self-approval only for callers who cannot supervise.

    An effective supervisor — or a business admin driving the module via
    workspace override — is the approval authority and may act on a draft they
    themselves submitted. This is what un-deadlocks the role-switch flow: a
    supervisor who created a pipeline while simulating the executive role then
    approves it as themselves (same user id, so ``submitted_by == actor.sub``).
    """
    if actor_can_supervise(actor):
        return
    if str(site.submitted_by) == str(actor["sub"]):
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="You cannot approve or reject a draft you submitted.",
        )


def _assert_can_edit_details(actor: dict, site: models.Site) -> None:
    """Executives may fill details only for their own or assigned sites,
    and only while the site is still in SHORTLISTED status (i.e. before
    they submit for review). After submission, only supervisors may edit."""
    if (actor.get("role") or "").lower() != "executive":
        return
    # Executives cannot edit after submitting for review.
    if site.status != SiteStatus.SHORTLISTED.value:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Cannot edit details after submitting for review. Only the supervisor can edit at this stage.",
        )
    actor_id = str(actor["sub"])
    if str(site.submitted_by) == actor_id or str(site.assigned_to or "") == actor_id:
        return
    raise HTTPException(
        status_code=http_status.HTTP_403_FORBIDDEN,
        detail="This site is not assigned to you.",
    )


# ── Create draft ──────────────────────────────────────────────────────────

def _prepare_staggered_escalation(staggered_escalation: list | None, rent_type: str | None) -> list | None:
    if not staggered_escalation or rent_type != "staggered":
        return None
    return [e if isinstance(e, dict) else e.model_dump(exclude_none=True) for e in staggered_escalation]

def _determine_rent_set_at(
    now: datetime, expected_rent, expected_escalation_pct, expected_revshare_pct, staggered_escalation
) -> datetime | None:
    if (
        expected_rent is not None
        or expected_escalation_pct is not None
        or expected_revshare_pct is not None
        or staggered_escalation is not None
    ):
        return now
    return None

async def _notify_draft_submission(session, tenant_id, site_id, name, city):
    # Every new draft lands in the pipeline as DRAFT_SUBMITTED and needs a
    # supervisor to shortlist it, so supervisors are always notified.
    recipients = await recipients_for_supervisors(session, tenant_id=tenant_id)
    await notify_enqueue(
        session,
        tenant_id=tenant_id,
        event="draft_submitted",
        recipient_ids=recipients,
        site_id=site_id,
        channels=("email", "slack", "in_app"),
        payload={"site_id": str(site_id), "site_name": name, "city": city},
    )

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
    google_maps_url: str | None = None,
    expected_rent: float | None = None,
    rent_type: str | None = None,
    expected_escalation_pct: float | None = None,
    expected_escalation_years: int | None = None,
    expected_revshare_pct: float | None = None,
    area_sqft: float | None = None,
    staggered_escalation: list | None = None,
    revshare_dinein_pct: float | None = None,
    revshare_delivery_pct: float | None = None,
) -> SiteResponse:
    """Create a pipeline draft. One canonical implementation used by both
    `POST /api/bd/drafts` and `POST /api/sites`.

    Every draft — whoever creates it — enters the pipeline as DRAFT_SUBMITTED
    and is shortlisted by a supervisor through the normal approval step. There
    is no supervisor auto-promote: a supervisor's own draft goes into the
    pipeline like any other, giving one consistent lifecycle. (A supervisor may
    approve their own draft; see `_assert_not_self_approval`.)
    """
    now = datetime.now(timezone.utc)

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
            google_maps_url=google_maps_url,
            expected_rent=expected_rent,
            rent_type=rent_type,
            expected_escalation_pct=expected_escalation_pct,
            expected_escalation_years=expected_escalation_years,
            expected_revshare_pct=expected_revshare_pct,
            revshare_dinein_pct=revshare_dinein_pct,
            revshare_delivery_pct=revshare_delivery_pct,
            area_sqft=area_sqft if area_sqft is not None else 0,
            staggered_escalation=_prepare_staggered_escalation(staggered_escalation, rent_type),
            rent_set_at=_determine_rent_set_at(
                now, expected_rent, expected_escalation_pct, expected_revshare_pct, staggered_escalation
            ),
            submitted_by=actor["sub"],
            shortlisted_at=None,
            supervisor_id=None,
        )
        session.add(site)
        from sqlalchemy.exc import SQLAlchemyError
        try:
            await session.flush()
        except SQLAlchemyError as e:
            import logging
            logging.getLogger(__name__).exception("Database schema mismatch or constraint violation during site creation.")
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Database schema mismatch or constraint violation during site creation. Please verify backend migrations.",
            ) from e

        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor["name"],
            action="create_draft",
            from_status=None,
            to_status=SiteStatus.DRAFT_SUBMITTED.value,
            detail=None,
        )
        await _notify_draft_submission(session, tenant_id, site.id, name, city)

    return site_to_response(site, created_by_name=actor["name"])


# ── Shortlist ─────────────────────────────────────────────────────────────

async def svc_shortlist_draft(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
) -> SiteResponse:
    """Shortlist a site as the acting supervisor, blocking self-approval of own draft."""
    async with transaction(session):
        site = await fetch_site_for_update_or_404(session, site_id=site_id, tenant_id=tenant_id)
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

def _pipeline_before_incoming(site: models.Site, details: dict) -> tuple[dict, dict]:
    """Build the (before, incoming) pipeline-field snapshots the audit differ
    compares. Shared by save + submit so the field set can't drift."""
    before = {
        "name": site.name,
        "city": site.city,
        "model": site.model,
        "spoc_name": site.spoc_name,
        "google_pin": site.google_maps_pin,
        "expected_rent": float(site.expected_rent) if site.expected_rent is not None else None,
        "rent_type": site.rent_type,
        "area_sqft": float(site.area_sqft) if site.area_sqft is not None else None,
        "revshare_dinein_pct": float(site.revshare_dinein_pct) if site.revshare_dinein_pct is not None else None,
        "revshare_delivery_pct": float(site.revshare_delivery_pct) if site.revshare_delivery_pct is not None else None,
    }
    incoming = {
        "name": details.get("name"),
        "city": details.get("city"),
        "model": details.get("model"),
        "spoc_name": details.get("spoc_name"),
        "google_pin": details.get("google_pin"),
        "expected_rent": _to_float(details.get("rent")),
        "rent_type": details.get("rent_type"),
        "area_sqft": _to_float(details.get("area_sqft")),
        "revshare_dinein_pct": _to_float(details.get("revshare_dinein_pct")),
        "revshare_delivery_pct": _to_float(details.get("revshare_delivery_pct")),
    }
    return before, incoming


def _apply_incoming_pipeline_fields(site: models.Site, incoming: dict) -> None:
    """Promote non-empty incoming pipeline fields onto the site row."""
    for k, v in incoming.items():
        if v is None or v == "":
            continue
        if k == "google_pin":
            site.google_maps_pin = v
        else:
            setattr(site, k, v)


def _apply_staggered_escalation(site: models.Site, details: dict, incoming: dict) -> None:
    """Set or clear the staggered schedule based on the effective rent_type."""
    current_rent_type = incoming.get("rent_type") or site.rent_type
    esc_raw = details.get("staggered_escalation")
    if current_rent_type == "staggered":
        if esc_raw is not None:
            site.staggered_escalation = [e if isinstance(e, dict) else e.model_dump(exclude_none=True) for e in esc_raw]
    else:
        site.staggered_escalation = None


def _apply_split_fields(site: models.Site, details: dict) -> None:
    """Revenue-share split (FEATURE_RENT_V2) is explicitly clearable: presence in
    the payload — not truthiness — decides, so a REV SHARE toggle-off nulls the
    row instead of being silently skipped like the None/'' partial-save fields."""
    for key in ("revshare_dinein_pct", "revshare_delivery_pct"):
        if key in details:
            setattr(site, key, _to_float(details[key]))


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
    details = _normalise_detail_keys(details or {})
    async with transaction(session):
        site = await fetch_site_for_update_or_404(session, site_id=site_id, tenant_id=tenant_id)
        _assert_can_edit_details(actor, site)
        # A supervisor (or business admin) amending an executive's submission tags
        # the field diffs distinctly, so the activity feed can highlight them and
        # the UI can flag the site yellow until the exec re-reads it. Editing while
        # acting as the executive (role == executive) stays a normal edit.
        acting_as_supervisor = (
            actor_can_supervise(actor) and (actor.get("role") or "").lower() != "executive"
        )
        edit_action = SUPERVISOR_EDIT_ACTION if acting_as_supervisor else "pipeline_field_edited"
        before, incoming = _pipeline_before_incoming(site, details)
        await diff_and_log_pipeline_fields(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor["name"],
            before=before,
            after=incoming,
            action=edit_action,
            actor_role=(actor.get("role") or None),
        )
        _apply_incoming_pipeline_fields(site, incoming)
        _apply_split_fields(site, details)
        if incoming.get("expected_rent") is not None:
            site.rent_set_at = datetime.now(timezone.utc)
        _apply_staggered_escalation(site, details, incoming)
        await _upsert_site_details(session, tenant_id=tenant_id, site_id=site.id, details=details)

    return OkResponse(message=f"Details draft saved for site {site_id}")


# ── Mark supervisor edits as seen ──────────────────────────────────────────

async def svc_mark_details_viewed(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict, site_id: str | UUID,
) -> OkResponse:
    """Record that the site's executive has re-read the details, clearing the
    supervisor-edit flag (yellow site + per-field eye highlight).

    Writes an ``exec_viewed_details`` audit marker only when there are unseen
    supervisor edits, so the activity feed isn't spammed on every open. The read
    side compares this marker's timestamp against later supervisor edits.
    """
    async with transaction(session):
        site = await fetch_site_for_update_or_404(session, site_id=site_id, tenant_id=tenant_id)
        unseen = await compute_unseen_supervisor_edits(
            session, tenant_id=tenant_id, site_ids=[site.id],
        )
        if not unseen.get(site.id):
            return OkResponse(message="No supervisor edits to acknowledge")
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor["name"],
            action=EXEC_VIEWED_ACTION,
            actor_role=(actor.get("role") or None),
            detail="Executive reviewed supervisor edits",
        )
    return OkResponse(message="Supervisor edits acknowledged")


# ── Submit details for review ─────────────────────────────────────────────

async def svc_submit_details(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    details: dict | None = None,
) -> SiteResponse:
    """Persist edited site details and submit them for supervisor review, logging field diffs."""
    details = _normalise_detail_keys(details or {})
    async with transaction(session):
        site = await fetch_site_for_update_or_404(session, site_id=site_id, tenant_id=tenant_id)
        _assert_can_edit_details(actor, site)
        assert_transition(SiteStatus(site.status), SiteStatus.DETAILS_SUBMITTED)
        if details:
            before, incoming = _pipeline_before_incoming(site, details)
            await diff_and_log_pipeline_fields(
                session, tenant_id=tenant_id, site_id=site.id,
                actor_id=actor["sub"], actor_name=actor["name"],
                before=before, after=incoming,
            )
            _apply_incoming_pipeline_fields(site, incoming)
            _apply_split_fields(site, details)
            _apply_staggered_escalation(site, details, incoming)
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
        recipients = await recipients_for_supervisors(session, tenant_id=tenant_id)
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
    """Approve a site's details and record the LOI deadline derived from expected_loi_days."""
    async with transaction(session):
        site = await fetch_site_for_update_or_404(session, site_id=site_id, tenant_id=tenant_id)
        current_status = SiteStatus(site.status)
        _assert_not_self_approval(actor, site)
        assert_transition(current_status, SiteStatus.APPROVED)
        approved_at = datetime.now(timezone.utc)
        site.status = SiteStatus.APPROVED.value
        site.approved_at = approved_at

        # Pre-compute the LOI deadline as a DATE (business deadlines are end-of-day, not a precise instant).
        # Stored on the approval row for efficient reads.
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
            from_status=current_status.value,
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


# ── Send to Legal Review (replaces the old "push to payments" terminal action) ─

async def svc_push_to_payments(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict, site_id: str | UUID,
) -> OkResponse:
    """BD Supervisor action: LOI_UPLOADED → LEGAL_REVIEW.

    Previously this was a terminal "push to payments" step. It now hands the site
    off to the Legal Department for their 4-step checklist. The route path
    `/staging/{site_id}/push` is kept unchanged for frontend back-compat.
    """
    async with transaction(session):
        site = await fetch_site_for_update_or_404(session, site_id=site_id, tenant_id=tenant_id)
        assert_transition(SiteStatus(site.status), SiteStatus.LEGAL_REVIEW)
        site.status = SiteStatus.LEGAL_REVIEW.value
        site.legal_review_at = datetime.now(timezone.utc)

        # Seed the DD checklist row so legal can start immediately; idempotent on retry.
        existing_legal_dd = (await session.execute(
            select(models.LegalDdChecklist).where(models.LegalDdChecklist.site_id == site.id)
        )).scalar_one_or_none()
        if existing_legal_dd is None:
            session.add(models.LegalDdChecklist(site_id=site.id))

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="send_to_legal",
            from_status=SiteStatus.LOI_UPLOADED.value,
            to_status=SiteStatus.LEGAL_REVIEW.value,
        )
        # Notify all legal supervisors in the tenant.
        legal_recipients = await recipients_for_legal_supervisors(session, tenant_id=tenant_id)
        await notify_enqueue(
            session, tenant_id=tenant_id, event="site_sent_to_legal",
            recipient_ids=legal_recipients, site_id=site.id,
            channels=("email", "in_app"),
            payload={"site_id": str(site.id), "site_name": site.name, "city": site.city},
            subject=f"New site for legal review: {site.name}",
            body=(
                f"The site '{site.name}' ({site.code or ''}) in {site.city} has been "
                f"submitted for legal review. Please open your Legal Dashboard to proceed."
            ),
        )
        # Acknowledge to BD exec/supervisor that it has been sent.
        owners = await recipients_for_site_owner(session, site=site)
        await notify_enqueue(
            session, tenant_id=tenant_id, event="site_sent_to_legal_ack",
            recipient_ids=owners, site_id=site.id,
            channels=("in_app",),
            payload={"site_id": str(site.id)},
        )
    return OkResponse(message=f"Site {site_id} sent to Legal Review")


# ── Reject ────────────────────────────────────────────────────────────────

async def svc_reject_site(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict,
    site_id: str | UUID, reasons: list[str], comment: Optional[str] = None,
) -> OkResponse:
    """Reject a site with reasons, blocking self-rejection and notifying the site owners."""
    async with transaction(session):
        site = await fetch_site_for_update_or_404(session, site_id=site_id, tenant_id=tenant_id)
        # Supervisors need a safe rejection path for shortlisted sites they created or received via delegation.
        if site.status != SiteStatus.SHORTLISTED.value:
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
    """Archive a site, requiring a non-empty note so the Archive tab stays browsable."""
    async with transaction(session):
        site = await fetch_site_for_update_or_404(session, site_id=site_id, tenant_id=tenant_id)
        # Archive note is mandatory — every archived site must carry a reason so the Archive tab is browsable.
        clean_note = (note or "").strip()
        if not clean_note:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="An archive note is required so the archived site stays browsable.",
            )
        assert_transition(SiteStatus(site.status), SiteStatus.ARCHIVED)
        # Store pre-archive status so Revive can restore it to the prior stage.
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

    Only the supervisor can revive — executives must ask
    for it. The site's `archived_from_status` field is the source of truth
    for where to put it back. If it's missing (older archives that predate
    the column), we fall back to draft_submitted so the site is at least
    re-visible in the pipeline.
    """
    role = (actor.get("role") or "").lower()
    if role not in ["supervisor", "business_admin"]:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Only the supervisor or business admin can revive a site.",
        )
    async with transaction(session):
        site = await fetch_site_for_update_or_404(session, site_id=site_id, tenant_id=tenant_id)
        
        allowed_statuses = [SiteStatus.ARCHIVED.value]
        if role == "business_admin":
            allowed_statuses.append(SiteStatus.REJECTED.value)

        if site.status not in allowed_statuses:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail=f"Site cannot be revived from its current status (current status={site.status}).",
            )
            
        old_status = site.status
        prev = site.archived_from_status or SiteStatus.DRAFT_SUBMITTED.value
        site.status = prev
        site.archived_at = None
        site.archived_from_status = None
        # Keep the archive_note as historical context — Revive doesn't erase the reason a site was once archived.
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="revive",
            from_status=old_status, to_status=prev,
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
    """Reassign a site to another active executive in the same workspace."""
    async with transaction(session):
        site = await fetch_site_for_update_or_404(session, site_id=site_id, tenant_id=tenant_id)
        assignee = (await session.execute(
            select(models.User).where(
                models.User.id == new_owner_id,
                models.User.tenant_id == tenant_id,
                models.User.is_active.is_(True),
            )
        )).scalar_one_or_none()
        if assignee is None:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="Executive not found in this workspace.",
            )
        assignee_role = (assignee.role or "").lower()
        is_self = str(new_owner_id) == str(actor["sub"])
        # Executives (and business admins) are always assignable; a supervisor
        # may also take the site on THEMSELVES (role flexibility) — but never
        # hand it to another supervisor's id.
        if assignee_role not in ("executive", "business_admin") and not is_self:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Sites can only be assigned to an executive, or taken on yourself.",
            )
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
    "revshare": "rev_share_pct",
    "rent_free_days": "rent_free_days",
    "cadex": "capex",
    "deposit": "security_deposit",
    "brokerage": "brokerage",
    "lockin": "lock_in_months",
    "tenure": "tenure_months",
    "rent_type": "rent_type",
}


_DETAIL_ALIASES = {
    "spoc_name": ("spoc_name", "spocName"),
    "google_pin": ("google_pin", "googlePin"),
    "rent_type": ("rent_type", "rentType"),
    "est_sales": ("est_sales", "estSales"),
    "nearest_starbucks": ("nearest_starbucks", "nearestStarbucks"),
    "nearest_twc": ("nearest_twc", "nearestTWC"),
    "rent_free_days": ("rent_free_days", "rentFreeDays"),
    "total_op_cost": ("total_op_cost", "totalOpCost"),
}


def _normalise_detail_keys(details: dict) -> dict:
    """Accept frontend camelCase and API snake_case detail payloads.

    The shortlist drawer reads from the persisted row, so dropping aliases here
    makes the UI appear empty even when the executive filled the form.
    """
    normalised = dict(details or {})
    for canonical, aliases in _DETAIL_ALIASES.items():
        if normalised.get(canonical) not in (None, ""):
            continue
        for alias in aliases:
            value = normalised.get(alias)
            if value not in (None, ""):
                normalised[canonical] = value
                break
    return normalised


async def _upsert_site_details(
    session: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID, details: dict,
) -> None:
    """Upsert site_details with whatever fields the form supplied. We do NOT
    write `fixed_rent_amt` — that column is tombstoned; rent lives on
    `sites.expected_rent`."""

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
