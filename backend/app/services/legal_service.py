"""Legal Department workflow service.

Three-table model (aligns with Module_State_Transitions_Handover spec):
  Step 1 · DD checklist items  → legal_dd_checklist (exec or supervisor updates items)
  Step 2 · Finalize DD verdict → legal_dd_checklist.final_verdict (supervisor only)
  Step 3 · Agreement           → site_agreement (supervisor only)
  Step 4 · Licensing           → site_licensing (supervisor; triggers LEGAL_APPROVED)

Cross-module status mirrors on sites that BD reads for dashboard chips:
  sites.legal_dd_status    → 'pending' | 'in_review' | 'positive' | 'negative'
  sites.agreement_status   → 'pending' | 'signed' | 'registered'
  sites.licensing_status   → 'pending' | 'partial' | 'complete'
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import select, text
from sqlalchemy.exc import ProgrammingError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

from app.db import models
from app.db.session import transaction
from app.domain.schemas.legal import (
    AgreementResponse,
    DdChecklistResponse,
    LegalQueueItem,
    LegalQueueResponse,
    LegalReviewResponse,
    LicensingResponse,
    SaveAgreementRequest,
    SaveDueDiligenceRequest,
    SaveLicensingRequest,
    SaveVerificationRequest,
)
from app.domain.state_machine import SiteStatus, assert_transition
from app.services._common import fetch_site_or_404, fetch_user_name
from app.services.audit_service import write_audit_event
from app.services.notification_service import (
    enqueue as notify_enqueue,
    recipients_for_legal_supervisors,
    recipients_for_site_owner,
)

logger = logging.getLogger(__name__)


# DD fields used for the auto-positive check in svc_save_verification.
# Core fields — all 7 must be 'yes' for auto-positive to fire.
# Optional slots (other_1 / other_2) are free-form additions whose values are
# NEVER NULL in the DB (schema is NOT NULL DEFAULT 'pending'). They must NOT
# block the positive verdict in their default 'pending' state — that's the
# "not used on this site" signal. If a supervisor has actively engaged them
# they must mark them 'yes'; any 'no' blocks auto-positive. NULL is kept in
# the allow-list as a defensive guard in case the schema is ever loosened.
_CORE_DD_FIELDS = (
    "title_doc", "sanctioned_plan", "oc_cc", "commercial_use",
    "property_tax", "electricity", "fire_noc",
)
_OPTIONAL_DD_FIELDS = ("other_1", "other_2")
# Values in the optional slots that do NOT block auto-positive recovery.
# 'pending' is the schema default — see _OPTIONAL_DD_FIELDS comment above.
_OPTIONAL_DD_NON_BLOCKING = (None, "pending", "yes")


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _fetch_dd_or_none(
    session: AsyncSession, *, site_id: str | UUID,
) -> Optional[models.LegalDdChecklist]:
    return (await session.execute(
        select(models.LegalDdChecklist).where(models.LegalDdChecklist.site_id == site_id)
    )).scalar_one_or_none()


async def _fetch_dd_or_404(
    session: AsyncSession, *, site_id: str | UUID,
) -> models.LegalDdChecklist:
    row = await _fetch_dd_or_none(session, site_id=site_id)
    if row is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=f"No DD checklist found for site {site_id}. Push the site to Legal Review first.",
        )
    return row


async def _fetch_agreement_or_none(
    session: AsyncSession, *, site_id: str | UUID,
) -> Optional[models.SiteAgreement]:
    return (await session.execute(
        select(models.SiteAgreement).where(models.SiteAgreement.site_id == site_id)
    )).scalar_one_or_none()


async def _fetch_licensing_or_none(
    session: AsyncSession, *, site_id: str | UUID,
) -> Optional[models.SiteLicensing]:
    return (await session.execute(
        select(models.SiteLicensing).where(models.SiteLicensing.site_id == site_id)
    )).scalar_one_or_none()


def _dd_to_response(dd: models.LegalDdChecklist) -> DdChecklistResponse:
    return DdChecklistResponse(
        title_doc=dd.title_doc,
        sanctioned_plan=dd.sanctioned_plan,
        oc_cc=dd.oc_cc,
        commercial_use=dd.commercial_use,
        property_tax=dd.property_tax,
        electricity=dd.electricity,
        fire_noc=dd.fire_noc,
        other_1=dd.other_1,
        other_2=dd.other_2,
        # Labels are nullable in the DB. getattr-guarded so pre-migration rows
        # (if any) gracefully degrade to None rather than 500.
        other_1_label=getattr(dd, "other_1_label", None),
        other_2_label=getattr(dd, "other_2_label", None),
        final_verdict=dd.final_verdict,
        rejection_reason=dd.rejection_reason,
        reviewed_by=str(dd.reviewed_by) if dd.reviewed_by else None,
        approved_by=str(dd.approved_by) if dd.approved_by else None,
        stage=getattr(dd, "stage", None) or "published",
        updated_at=dd.updated_at,
    )


def _agreement_to_response(ag: models.SiteAgreement) -> AgreementResponse:
    return AgreementResponse(
        signed=ag.signed,
        signed_at=ag.signed_at,
        registered=ag.registered,
        registered_at=ag.registered_at,
        document_url=ag.document_url,
    )


def _licensing_to_response(lic: models.SiteLicensing) -> LicensingResponse:
    return LicensingResponse(
        fssai=lic.fssai,
        health_trade=lic.health_trade,
        shops_estab_reg=lic.shops_estab_reg,
        fire_noc=lic.fire_noc,
        storage_license=lic.storage_license,
        stage=getattr(lic, "stage", None) or "published",
        updated_at=lic.updated_at,
    )


async def _build_review_response(
    session: AsyncSession, site: models.Site,
) -> LegalReviewResponse:
    dd  = await _fetch_dd_or_none(session, site_id=site.id)
    ag  = await _fetch_agreement_or_none(session, site_id=site.id)
    lic = await _fetch_licensing_or_none(session, site_id=site.id)
    submitted_by_name = await fetch_user_name(session, site.submitted_by)
    return LegalReviewResponse(
        site_id=str(site.id),
        site_code=site.code or "",
        site_name=site.name,
        city=site.city,
        submitted_by_name=submitted_by_name,
        tenant_id=str(site.tenant_id),
        site_status=site.status,
        legal_dd_status=site.legal_dd_status,
        agreement_status=site.agreement_status,
        licensing_status=site.licensing_status,
        dd=_dd_to_response(dd) if dd else None,
        agreement=_agreement_to_response(ag) if ag else None,
        licensing=_licensing_to_response(lic) if lic else None,
    )


# ── Staging helpers (migration 202605272_checklist_stage) ────────────────────
#
# Executive writes are gated by both an active site_delegations row AND the row
# being in 'draft' stage. Supervisor writes are unrestricted (any stage).
#
# Defensive defaults:
#   - site_delegations table may not exist yet (U2 slice). Treat absent table
#     as "no delegation" rather than raising.
#   - stage column may not have landed in the live DB yet (race between deploy
#     and migration). Treat missing attribute as 'published'.

async def _executive_has_legal_delegation(
    session: AsyncSession, *, site_id: str | UUID, user_id: str | UUID,
) -> bool:
    """Return True if there's an active legal delegation for (site, user).

    Returns False (rather than raising) if the site_delegations table doesn't
    exist yet — keeps this slice independent of the U2 delegation slice.
    """
    try:
        result = await session.execute(
            text(
                """
                SELECT 1
                  FROM site_delegations
                 WHERE site_id = :site_id
                   AND module = 'legal'
                   AND delegate_user_id = :user_id
                   AND revoked_at IS NULL
                 LIMIT 1
                """
            ),
            {"site_id": str(site_id), "user_id": str(user_id)},
        )
        return result.first() is not None
    except ProgrammingError:
        await session.rollback()
        return False
    except Exception:
        return False


async def _require_executive_legal_delegation(
    session: AsyncSession, *, site_id: str | UUID, actor: dict,
) -> bool:
    """Enforce executive delegation gate, no-op for non-executives.

    Returns True if the caller is an executive (so the caller can branch on
    stage rules). Raises 403 if an executive caller lacks an active delegation.
    """
    if actor.get("role") != "executive":
        return False
    has_delegation = await _executive_has_legal_delegation(
        session, site_id=site_id, user_id=actor["sub"],
    )
    if not has_delegation:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail=(
                "Executive does not have an active legal delegation on this site. "
                "Ask the legal supervisor to delegate first."
            ),
        )
    return True


def _row_stage(row) -> str:
    """Read the `stage` attribute, tolerating absence (pre-migration window)."""
    return getattr(row, "stage", None) or "published"


def _assert_executive_can_edit_stage(stage: str) -> None:
    """Raise 422 if executive attempts to edit a non-draft row."""
    if stage != "draft":
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Cannot edit checklist while stage is '{stage}'. "
                "Executives may only edit drafts; once submitted, edits are "
                "locked until the supervisor publishes the row."
            ),
        )


def _assert_supervisor_can_edit_stage(stage: str) -> None:
    """Raise 422 if supervisor attempts to edit a published DD row.

    Once a verdict is published (stage='published'), the row is the source of
    truth that BD reads from — the mirror columns on `sites` are stamped, the
    failed-DDR / staging-tracker queues partition off this state, and the
    decision is part of the externally-visible audit trail. Allowing a
    supervisor to silently re-edit a published row would let them change
    what BD sees without a record of the change request that authorized it.

    Edits to a published row must therefore flow through the change-request
    path (POST /legal/change-requests, processed by
    change_request_service.approve_change_request) so the audit trail captures
    who requested the change, what was approved, and why. The
    _maybe_recover_dd_verdict helper in that service handles the verdict +
    site-status side-effects symmetrically with svc_save_verification's
    auto-positive check, so both paths converge on the same outcome.

    Supervisors remain free to edit at stage='draft' (typically only when
    they're fixing items inline before any executive submission) and at
    stage='pending_review' (the review-and-adjust window before publishing).
    """
    if stage == "published":
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "DDR is published — BD reads this row as the source of truth. "
                "Open a change request (POST /legal/change-requests) to edit a "
                "published checklist; that path captures the request → approval "
                "trail BD relies on."
            ),
        )


# ── Queue ─────────────────────────────────────────────────────────────────────

async def svc_legal_queue(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    restrict_to_site_ids: Optional[list[str]] = None,
) -> LegalQueueResponse:
    """Return all sites in LEGAL_REVIEW or LEGAL_REJECTED with their DD status.

    LEGAL_REJECTED sites are included so the legal supervisor can see them in
    their queue (marked with a 'negative' badge) and directly fix the failing
    DD items without the site vanishing from their dashboard.

    `restrict_to_site_ids` is an optional additive filter the router passes
    when the caller is an executive (so they see only delegated sites).
    Pass None for the supervisor-wide view.
    """
    stmt = (
        select(models.Site)
        .where(
            models.Site.tenant_id == tenant_id,
            models.Site.status.in_([
                SiteStatus.LEGAL_REVIEW.value,
                SiteStatus.LEGAL_REJECTED.value,
            ]),
        )
        .order_by(models.Site.legal_review_at.asc())
    )
    if restrict_to_site_ids is not None:
        if not restrict_to_site_ids:
            return LegalQueueResponse(items=[], total=0)
        stmt = stmt.where(models.Site.id.in_(restrict_to_site_ids))

    sites = (await session.execute(stmt)).scalars().all()

    items: list[LegalQueueItem] = []
    for site in sites:
        dd = await _fetch_dd_or_none(session, site_id=site.id)
        submitted_by_name = await fetch_user_name(session, site.submitted_by)
        items.append(LegalQueueItem(
            site_id=str(site.id),
            site_code=site.code or "",
            site_name=site.name,
            city=site.city,
            legal_dd_status=site.legal_dd_status or "pending",
            dd_final_verdict=dd.final_verdict if dd else "pending",
            # _row_stage tolerates the column being missing during the
            # migration window — falls back to 'published'.
            dd_stage=_row_stage(dd) if dd else "published",
            legal_review_at=site.legal_review_at,
            submitted_by_name=submitted_by_name,
        ))

    return LegalQueueResponse(items=items, total=len(items))


async def svc_get_legal_review(
    session: AsyncSession, *, site_id: str | UUID, tenant_id: str | UUID,
) -> LegalReviewResponse:
    site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
    return await _build_review_response(session, site)


# ── Step 1 · Save DD checklist items ─────────────────────────────────────────

async def svc_save_verification(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: SaveVerificationRequest,
) -> LegalReviewResponse:
    """Create or update the DD checklist row; set sites.legal_dd_status = 'in_review'.

    Stage gate (migration 202605272):
      - Executive callers must have an active site_delegations row for
        (site, module='legal'). On insert, stage starts at 'draft'. They may
        only update rows whose stage is 'draft'; pending_review / published
        raise 422.
      - Supervisor callers are unrestricted (can write at any stage).
    """
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)

        _VALID_EDIT_STATUSES = {
            SiteStatus.LEGAL_REVIEW.value,
            SiteStatus.LEGAL_REJECTED.value,
        }
        if site.status not in _VALID_EDIT_STATUSES:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Site is not in a legal workflow status (current: {site.status})",
            )

        # Executives cannot directly edit a LEGAL_REJECTED site — they must
        # open a change request (POST /legal/change-requests) so there is a
        # formal approval trail.  Supervisors may edit directly; the auto-positive
        # check below will recover the site to LEGAL_REVIEW if all items pass.
        if (
            site.status == SiteStatus.LEGAL_REJECTED.value
            and actor.get("role") == "executive"
        ):
            raise HTTPException(
                status_code=http_status.HTTP_403_FORBIDDEN,
                detail=(
                    "Executives cannot directly edit checklist items on a rejected site. "
                    "Open a change request instead (POST /legal/change-requests)."
                ),
            )

        # Delegation check applies only when the site is in LEGAL_REVIEW.
        # On a LEGAL_REJECTED site only supervisors reach this point (blocked above),
        # and _require_executive_legal_delegation is a no-op for supervisors.
        is_executive = await _require_executive_legal_delegation(
            session, site_id=site.id, actor=actor,
        )

        dd = await _fetch_dd_or_none(session, site_id=site.id)
        if dd is None:
            dd = models.LegalDdChecklist(site_id=site.id)
            # Executive-initiated rows start as drafts; supervisor inserts
            # behave as before (default: 'published').
            if is_executive:
                dd.stage = "draft"
            session.add(dd)
        elif is_executive:
            _assert_executive_can_edit_stage(_row_stage(dd))
        else:
            # Supervisor path: blocked from editing items once the row is
            # published — BD reads published rows as the source of truth, so
            # any post-publish change must flow through the change-request
            # path (where the request + approval are explicitly logged).
            # Draft and pending_review rows remain freely editable so the
            # supervisor can adjust items either before the executive submits
            # or after reviewing what they sent.
            _assert_supervisor_can_edit_stage(_row_stage(dd))

        # Only overwrite fields that were explicitly supplied
        for field in (
            "title_doc", "sanctioned_plan", "oc_cc", "commercial_use",
            "property_tax", "electricity", "fire_noc", "other_1", "other_2",
        ):
            val = getattr(body, field)
            if val is not None:
                setattr(dd, field, val)

        # Labels round-trip alongside their status. None ⇒ no change (partial
        # save semantics); empty string ⇒ explicit clear (slot retired by the
        # user removing the row). Anything else is stored verbatim — the DB
        # column is plain text with no enum constraint.
        for label_field in ("other_1_label", "other_2_label"):
            val = getattr(body, label_field, None)
            if val is None:
                continue
            if val == "":
                setattr(dd, label_field, None)
            else:
                setattr(dd, label_field, val)

        dd.reviewed_by = actor["sub"]

        # ── Auto-positive check with LEGAL_REJECTED recovery ─────────────────
        # After every supervisor edit, check if all required DD items are 'yes'.
        # Rule: 7 core items must be 'yes'; other_1/other_2 must be in
        # _OPTIONAL_DD_NON_BLOCKING (None, 'pending', 'yes') — i.e. not 'no'.
        # The schema defaults other_1/other_2 to 'pending', so a supervisor who
        # never touches those fields still gets auto-positive once the 7 core
        # items are green (matches the original PR #29 intent — see the
        # _OPTIONAL_DD_FIELDS docstring).
        # If the bar is met:
        #   1. final_verdict → 'positive', legal_dd_status → 'positive'
        #   2. If site was LEGAL_REJECTED, transition back to LEGAL_REVIEW so
        #      it re-enters the active workflow and reappears in the queue.
        #
        # This is the direct-edit recovery path for supervisors.  BD executives
        # go through change_request_service (_maybe_recover_dd_verdict) which
        # uses the same core/optional split.
        # A verdict already 'positive' is never downgraded here.
        if dd.final_verdict != "positive":
            all_required_yes = (
                all(getattr(dd, f) == "yes" for f in _CORE_DD_FIELDS)
                and all(getattr(dd, f) in _OPTIONAL_DD_NON_BLOCKING for f in _OPTIONAL_DD_FIELDS)
            )
            if all_required_yes:
                dd.final_verdict = "positive"
                site.legal_dd_status = "positive"
                was_rejected = site.status == SiteStatus.LEGAL_REJECTED.value
                if was_rejected:
                    assert_transition(SiteStatus.LEGAL_REJECTED, SiteStatus.LEGAL_REVIEW)
                    site.status = SiteStatus.LEGAL_REVIEW.value
                    site.legal_rejected_at = None
                await write_audit_event(
                    session, tenant_id=tenant_id, site_id=site.id,
                    actor_id=actor["sub"], actor_name=actor["name"],
                    action="legal_dd_auto_positive",
                    detail=(
                        "All DD items marked yes — verdict auto-set to positive"
                        + ("; site recovered to LEGAL_REVIEW" if was_rejected else "")
                    ),
                )
            else:
                # Still working through items.  Reset mirror to 'in_review'
                # to show the queue badge as "in progress" even if recovering
                # from a 'negative' verdict.
                site.legal_dd_status = "in_review"
                await write_audit_event(
                    session, tenant_id=tenant_id, site_id=site.id,
                    actor_id=actor["sub"], actor_name=actor["name"],
                    action="legal_dd_items_saved",
                    detail="DD checklist items updated",
                )
        else:
            # Verdict already positive — save as supplementary edits only.
            await write_audit_event(
                session, tenant_id=tenant_id, site_id=site.id,
                actor_id=actor["sub"], actor_name=actor["name"],
                action="legal_dd_items_saved",
                detail="DD checklist items updated (post-positive)",
            )

    return await _build_review_response(session, site)


# ── Submit DD draft for supervisor review (executive only) ───────────────────

async def svc_submit_dd_for_review(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
) -> LegalReviewResponse:
    """Executive flips DD checklist stage: 'draft' → 'pending_review'.

    Notifies the legal supervisor pool that a review is queued.
    """
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        dd   = await _fetch_dd_or_404(session, site_id=site.id)

        await _require_executive_legal_delegation(session, site_id=site.id, actor=actor)

        current_stage = _row_stage(dd)
        if current_stage != "draft":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"DD checklist is not in 'draft' (current: {current_stage}); cannot submit for review.",
            )

        dd.stage = "pending_review"

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="legal_dd_submitted_for_review",
            detail="Executive submitted DD draft for supervisor review",
        )
        legal_recipients = await recipients_for_legal_supervisors(session, tenant_id=tenant_id)
        if legal_recipients:
            await notify_enqueue(
                session, tenant_id=tenant_id, event="legal_dd_pending_review",
                recipient_ids=legal_recipients, site_id=site.id,
                channels=("email", "in_app"),
                payload={
                    "site_id": str(site.id),
                    "site_name": site.name,
                    "submitted_by": actor.get("name"),
                },
                subject=f"DD review pending: {site.name}",
                body=(
                    f"The legal executive {actor.get('name') or ''} has submitted the DD "
                    f"checklist for '{site.name}' ({site.code}) for supervisor review."
                ),
            )

    return await _build_review_response(session, site)


# ── Step 2 · Finalize DD verdict ──────────────────────────────────────────────

async def svc_save_due_diligence(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: SaveDueDiligenceRequest,
) -> LegalReviewResponse:
    """Supervisor stamps the final verdict on the DD checklist."""
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        dd   = await _fetch_dd_or_404(session, site_id=site.id)

        # Positive verdicts may also be submitted on a LEGAL_REJECTED site —
        # the supervisor has corrected all items and is finalising inline.
        # In that case we first recover the site to LEGAL_REVIEW, then proceed
        # with the normal positive-verdict path (avoids a separate save step).
        # Negative verdicts can only be submitted from LEGAL_REVIEW (you cannot
        # re-reject a site that is already rejected).
        _allowed = {SiteStatus.LEGAL_REVIEW.value}
        if body.final_verdict == "positive":
            _allowed.add(SiteStatus.LEGAL_REJECTED.value)

        if site.status not in _allowed:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Site is not in legal_review (current: {site.status})",
            )

        # If recovering from LEGAL_REJECTED, transition to LEGAL_REVIEW first
        # so the rest of the function runs against a consistent LEGAL_REVIEW state.
        if site.status == SiteStatus.LEGAL_REJECTED.value:
            assert_transition(SiteStatus.LEGAL_REJECTED, SiteStatus.LEGAL_REVIEW)
            site.status = SiteStatus.LEGAL_REVIEW.value
            site.legal_rejected_at = None

        dd.final_verdict   = body.final_verdict
        dd.rejection_reason = body.rejection_reason
        dd.approved_by     = actor["sub"]
        # Finalising publishes the row regardless of verdict — BD reads only
        # published rows, and a negative verdict is BD-actionable too.
        dd.stage = "published"

        if body.final_verdict == "negative":
            # ── Reject path ──────────────────────────────────────────────────
            site.legal_dd_status = "negative"
            assert_transition(SiteStatus(site.status), SiteStatus.LEGAL_REJECTED)
            site.status = SiteStatus.LEGAL_REJECTED.value
            site.legal_rejected_at = datetime.now(timezone.utc)

            await write_audit_event(
                session, tenant_id=tenant_id, site_id=site.id,
                actor_id=actor["sub"], actor_name=actor["name"],
                action="legal_dd_rejected",
                from_status=SiteStatus.LEGAL_REVIEW.value,
                to_status=SiteStatus.LEGAL_REJECTED.value,
                detail=f"Negative DD: {body.rejection_reason}",
            )
            bd_recipients = await recipients_for_site_owner(session, site=site)
            await notify_enqueue(
                session, tenant_id=tenant_id, event="legal_rejected",
                recipient_ids=bd_recipients, site_id=site.id,
                channels=("email", "in_app"),
                payload={
                    "site_id": str(site.id),
                    "site_name": site.name,
                    "rejection_reason": body.rejection_reason,
                },
                subject=f"Legal rejected: {site.name}",
                body=(
                    f"The site '{site.name}' ({site.code}) was rejected by the Legal team "
                    f"after Due Diligence.\n\nReason: {body.rejection_reason}"
                ),
            )
        else:
            # ── Positive path ────────────────────────────────────────────────
            site.legal_dd_status = "positive"
            await write_audit_event(
                session, tenant_id=tenant_id, site_id=site.id,
                actor_id=actor["sub"], actor_name=actor["name"],
                action="legal_dd_positive",
                detail="Positive DD — proceeding to Agreement",
            )

            # Auto-inherit licensing: the same `site_delegations` row (module='legal')
            # covers both DD and licensing. Wrapped in a SAVEPOINT inside the helper
            # so that a missing site_delegations table is a silent no-op rather than
            # aborting the DD-finalize transaction.
            delegate_user_id = await _find_legal_delegate(session, site_id=site.id)
            if delegate_user_id is not None:
                await write_audit_event(
                    session, tenant_id=tenant_id, site_id=site.id,
                    actor_id=actor["sub"], actor_name=actor["name"],
                    action="legal_licensing_auto_inherited",
                    detail=json.dumps({"delegate_user_id": str(delegate_user_id)}),
                )
                await notify_enqueue(
                    session, tenant_id=tenant_id,
                    event="legal_licensing_assigned",
                    recipient_ids=[delegate_user_id], site_id=site.id,
                    channels=("in_app",),
                    payload={
                        "site_id":   str(site.id),
                        "site_name": site.name,
                    },
                    subject=f"Licensing assigned: {site.name}",
                    body=(
                        f"You have been auto-assigned licensing for '{site.name}' "
                        f"({site.code}) following a positive DD verdict."
                    ),
                )

    return await _build_review_response(session, site)


async def _find_legal_delegate(
    session: AsyncSession, *, site_id: str | UUID,
) -> Optional[UUID]:
    """Look up the legal delegate for a site, tolerating a missing U2 table.

    Returns the delegate's user id or None if no active delegation. Uses a
    SAVEPOINT + SQLAlchemyError catch so a missing `site_delegations` table is
    a silent no-op rather than aborting the outer transaction.
    """
    try:
        async with session.begin_nested():
            row = (await session.execute(
                text(
                    """
                    SELECT delegate_user_id
                      FROM site_delegations
                     WHERE site_id   = :site_id
                       AND module    = 'legal'
                       AND revoked_at IS NULL
                     LIMIT 1
                    """
                ),
                {"site_id": str(site_id)},
            )).first()
        return row[0] if row else None
    except SQLAlchemyError as exc:
        # Most likely UndefinedTable: site_delegations table missing.
        # SAVEPOINT was rolled back, so the outer transaction stays clean.
        logger.info(
            "site_delegations lookup skipped for site %s (table missing or query failed): %s",
            site_id, exc,
        )
        return None


# ── Step 3 · Agreement ────────────────────────────────────────────────────────

async def svc_save_agreement(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: SaveAgreementRequest,
) -> LegalReviewResponse:
    """Create or update the agreement row; mirror to sites.agreement_status."""
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        dd   = await _fetch_dd_or_404(session, site_id=site.id)

        if dd.final_verdict != "positive":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Complete Due Diligence with a positive verdict (Step 2) before saving Agreement",
            )

        now = datetime.now(timezone.utc)
        ag  = await _fetch_agreement_or_none(session, site_id=site.id)
        if ag is None:
            ag = models.SiteAgreement(site_id=site.id)
            session.add(ag)

        if body.document_url is not None:
            ag.document_url = body.document_url

        if body.signed and not ag.signed:
            ag.signed    = True
            ag.signed_at = now
            site.agreement_status = "signed"

        if body.registered and not ag.registered:
            ag.registered    = True
            ag.registered_at = now
            site.agreement_status = "registered"

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="legal_agreement_saved",
            detail=f"signed={body.signed} registered={body.registered}",
        )

    return await _build_review_response(session, site)


# ── Step 4 · Licensing → auto-approve ────────────────────────────────────────

async def svc_save_licensing(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: SaveLicensingRequest,
) -> LegalReviewResponse:
    """Create or update the licensing row.

    Stage gate (migration 202605272):
      - Executive callers must hold an active legal site_delegations row and
        may only mutate while stage='draft'. On insert by executive, stage
        starts at 'draft'.
      - Supervisor callers are unrestricted. When the supervisor saves AND all
        five items are 'yes', stage is flipped to 'published'. Partial saves
        leave stage untouched.

    When all five items are 'yes':
      - sites.licensing_status → 'complete'
      - sites.status → LEGAL_APPROVED (legal workflow done)
      - BD notified via email + in_app
    """
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        ag   = await _fetch_agreement_or_none(session, site_id=site.id)
        # Note: agreement is fetched here but the registered check is deferred
        # to the auto-approve path below. Draft saves are allowed without agreement
        # so supervisors can record licensing status while agreement is being finalised.

        is_executive = await _require_executive_legal_delegation(
            session, site_id=site.id, actor=actor,
        )

        lic = await _fetch_licensing_or_none(session, site_id=site.id)
        if lic is None:
            lic = models.SiteLicensing(site_id=site.id)
            if is_executive:
                lic.stage = "draft"
            session.add(lic)
        elif is_executive:
            _assert_executive_can_edit_stage(_row_stage(lic))

        for field in ("fssai", "health_trade", "shops_estab_reg", "fire_noc", "storage_license"):
            val = getattr(body, field)
            if val is not None:
                setattr(lic, field, val)

        # Check if all five are now 'yes'
        all_done = all(
            getattr(lic, f) == "yes"
            for f in ("fssai", "health_trade", "shops_estab_reg", "fire_noc", "storage_license")
        )

        if all_done and not is_executive:
            # Only the supervisor's "all yes" save publishes the row AND
            # auto-approves the site. An executive who flips them all stays in
            # draft and must Submit-for-review → supervisor publishes.
            #
            # Agreement MUST be registered before licensing can complete — check
            # only here so that draft / partial saves are never blocked.
            if ag is None or not ag.registered:
                raise HTTPException(
                    status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Agreement must be registered (Step 3) before finalising Licensing",
                )
            lic.stage = "published"

            site.licensing_status = "complete"
            # Auto-approve: transition LEGAL_REVIEW → LEGAL_APPROVED
            assert_transition(SiteStatus(site.status), SiteStatus.LEGAL_APPROVED)
            site.status = SiteStatus.LEGAL_APPROVED.value
            site.legal_approved_at = datetime.now(timezone.utc)

            await write_audit_event(
                session, tenant_id=tenant_id, site_id=site.id,
                actor_id=actor["sub"], actor_name=actor["name"],
                action="legal_approved",
                from_status=SiteStatus.LEGAL_REVIEW.value,
                to_status=SiteStatus.LEGAL_APPROVED.value,
                detail="All licensing checks done — Legal Approved",
            )
            bd_recipients = await recipients_for_site_owner(session, site=site)
            await notify_enqueue(
                session, tenant_id=tenant_id, event="legal_approved",
                recipient_ids=bd_recipients, site_id=site.id,
                channels=("email", "in_app"),
                payload={"site_id": str(site.id), "site_name": site.name},
                subject=f"Legal approved: {site.name}",
                body=(
                    f"The site '{site.name}' ({site.code}) has been fully cleared by Legal "
                    f"and is now ready for the Payments module."
                ),
            )
        else:
            site.licensing_status = "partial"
            await write_audit_event(
                session, tenant_id=tenant_id, site_id=site.id,
                actor_id=actor["sub"], actor_name=actor["name"],
                action="legal_licensing_partial",
                detail="Licensing items partially saved",
            )

    return await _build_review_response(session, site)


# ── Submit licensing draft for supervisor review (executive only) ────────────

async def svc_submit_licensing_for_review(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
) -> LegalReviewResponse:
    """Executive flips licensing stage: 'draft' → 'pending_review'.

    Notifies the legal supervisor pool that a review is queued.
    """
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        lic  = await _fetch_licensing_or_none(session, site_id=site.id)
        if lic is None:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail=f"No licensing row found for site {site_id}. Save licensing items first.",
            )

        await _require_executive_legal_delegation(session, site_id=site.id, actor=actor)

        current_stage = _row_stage(lic)
        if current_stage != "draft":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Licensing is not in 'draft' (current: {current_stage}); cannot submit for review.",
            )

        lic.stage = "pending_review"

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="legal_licensing_submitted_for_review",
            detail="Executive submitted licensing draft for supervisor review",
        )
        legal_recipients = await recipients_for_legal_supervisors(session, tenant_id=tenant_id)
        if legal_recipients:
            await notify_enqueue(
                session, tenant_id=tenant_id, event="legal_licensing_pending_review",
                recipient_ids=legal_recipients, site_id=site.id,
                channels=("email", "in_app"),
                payload={
                    "site_id": str(site.id),
                    "site_name": site.name,
                    "submitted_by": actor.get("name"),
                },
                subject=f"Licensing review pending: {site.name}",
                body=(
                    f"The legal executive {actor.get('name') or ''} has submitted the licensing "
                    f"checklist for '{site.name}' ({site.code}) for supervisor review."
                ),
            )

    return await _build_review_response(session, site)
