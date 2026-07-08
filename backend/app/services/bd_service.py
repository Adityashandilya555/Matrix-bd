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
    fetch_site_for_update_or_404,
    fetch_site_or_404,
    fetch_user_name,
    make_site_code,
    site_to_response,
)
from app.services.audit_service import diff_and_log_pipeline_fields, write_audit_event
from app.services.notification_service import (
    enqueue as notify_enqueue,
    recipients_for_legal_supervisors,
    recipients_for_site_owner,
    recipients_for_supervisors,
)


# ── Authorisation guards ──────────────────────────────────────────────────
#
# Self-approval rule: whoever submitted the draft cannot also be the one who
# approves / rejects it. The supervisor's own drafts skip approval entirely
# via the auto-promote rule (see Todo #10) — they never reach these guards as
# a self-approval. This is purely defensive.


def _assert_not_self_approval(actor: dict, site: models.Site) -> None:
    """Self-approval guard. The submitter cannot also be the approver/rejecter
    of the same draft. A supervisor draft never reaches here because it
    auto-promotes — see svc_create_draft."""
    if actor.get("real_role") == "business_admin":
        return

    delegated_supervisor_created_site = (
        (actor.get("role") or "").lower() == "supervisor"
        and site.status == SiteStatus.DETAILS_SUBMITTED.value
        and site.assigned_to is not None
        and str(site.assigned_to) != str(actor["sub"])
        and str(site.submitted_by) == str(actor["sub"])
        and str(site.supervisor_id or "") == str(actor["sub"])
    )
    if str(site.submitted_by) == str(actor["sub"]) and not delegated_supervisor_created_site:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="You cannot approve or reject a draft you submitted.",
        )


def _assert_can_edit_details(actor: dict, site: models.Site) -> None:
    """Executives may fill details only for their own or assigned sites."""
    if (actor.get("role") or "").lower() != "executive":
        return
    actor_id = str(actor["sub"])
    if str(site.submitted_by) == actor_id or str(site.assigned_to or "") == actor_id:
        return
    raise HTTPException(
        status_code=http_status.HTTP_403_FORBIDDEN,
        detail="This site is not assigned to you.",
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
    google_maps_url: str | None = None,
    expected_rent: float | None = None,
    rent_type: str | None = None,
    expected_escalation_pct: float | None = None,
    expected_escalation_years: int | None = None,
    expected_revshare_pct: float | None = None,
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
            google_maps_url=google_maps_url,
            expected_rent=expected_rent,
            rent_type=rent_type,
            expected_escalation_pct=expected_escalation_pct,
            expected_escalation_years=expected_escalation_years,
            expected_revshare_pct=expected_revshare_pct,
            rent_set_at=now if (
                expected_rent is not None
                or expected_escalation_pct is not None
                or expected_revshare_pct is not None
            ) else None,
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
            recipients = await recipients_for_supervisors(session, tenant_id=tenant_id)
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
    """Persist edited site details and submit them for supervisor review, logging field diffs."""
    details = _normalise_detail_keys(details or {})
    async with transaction(session):
        site = await fetch_site_for_update_or_404(session, site_id=site_id, tenant_id=tenant_id)
        _assert_can_edit_details(actor, site)
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
    if (actor.get("role") or "").lower() != "supervisor":
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Only the supervisor can revive an archived site.",
        )
    async with transaction(session):
        site = await fetch_site_for_update_or_404(session, site_id=site_id, tenant_id=tenant_id)
        if site.status != SiteStatus.ARCHIVED.value:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail=f"Site is not archived (current status={site.status}).",
            )
        prev = site.archived_from_status or SiteStatus.DRAFT_SUBMITTED.value
        site.status = prev
        site.archived_at = None
        site.archived_from_status = None
        # Keep the archive_note as historical context — Revive doesn't erase the reason a site was once archived.
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
    """Reassign a site to another active executive in the same workspace."""
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
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
        if assignee_role not in ("executive", "business_admin"):
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Sites can only be assigned to an executive.",
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
