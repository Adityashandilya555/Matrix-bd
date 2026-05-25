"""Legal Department workflow service.

Implements the 4-step checklist:
  Step 1 · Verification Checklist  (7 boolean fields)
  Step 2 · Due Diligence Decision  (positive → continue; negative → reject + notify BD)
  Step 3 · Agreement               (2 boolean fields)
  Step 4 · Licensing               (5 boolean fields → auto-approves on completion)

Each public `svc_legal_*` function follows the same pattern as bd_service:
  1. Open / reuse transaction
  2. Fetch + tenant-scope the legal_review row
  3. Validate workflow state
  4. Mutate
  5. Write audit event
  6. Write notification outbox rows
  7. Commit
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.db.session import transaction
from app.domain.schemas.common import OkResponse
from app.domain.schemas.legal import (
    LegalQueueItem,
    LegalQueueResponse,
    LegalReviewResponse,
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


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _fetch_review_or_404(
    session: AsyncSession, *, site_id: str | UUID, tenant_id: str | UUID,
) -> models.LegalReview:
    stmt = select(models.LegalReview).where(
        models.LegalReview.site_id == site_id,
        models.LegalReview.tenant_id == tenant_id,
    )
    review = (await session.execute(stmt)).scalar_one_or_none()
    if review is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=f"No legal review found for site {site_id}",
        )
    return review


def _review_to_response(r: models.LegalReview) -> LegalReviewResponse:
    return LegalReviewResponse(
        id=str(r.id),
        site_id=str(r.site_id),
        tenant_id=str(r.tenant_id),
        reviewer_id=str(r.reviewer_id) if r.reviewer_id else None,
        status=r.status,
        title_check=r.title_check,
        sanctioned_plan_check=r.sanctioned_plan_check,
        oc_cc_check=r.oc_cc_check,
        commercial_uses_check=r.commercial_uses_check,
        property_tax_check=r.property_tax_check,
        electricity_check=r.electricity_check,
        fire_noc_verification_check=r.fire_noc_verification_check,
        due_diligence_status=r.due_diligence_status,
        rejection_reason=r.rejection_reason,
        agreement_signed=r.agreement_signed,
        agreement_registered=r.agreement_registered,
        fssai_check=r.fssai_check,
        health_trade_license_check=r.health_trade_license_check,
        shops_license_check=r.shops_license_check,
        fire_noc_licensing_check=r.fire_noc_licensing_check,
        storage_license_check=r.storage_license_check,
        verification_completed_at=r.verification_completed_at,
        due_diligence_completed_at=r.due_diligence_completed_at,
        agreement_completed_at=r.agreement_completed_at,
        licensing_completed_at=r.licensing_completed_at,
        completed_at=r.completed_at,
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


# ── Queue ─────────────────────────────────────────────────────────────────────

async def svc_legal_queue(
    session: AsyncSession, *, tenant_id: str | UUID,
) -> LegalQueueResponse:
    """Return all sites currently in LEGAL_REVIEW, with their review record status."""
    stmt = (
        select(models.Site, models.LegalReview)
        .join(models.LegalReview, models.LegalReview.site_id == models.Site.id)
        .where(
            models.Site.tenant_id == tenant_id,
            models.Site.status == SiteStatus.LEGAL_REVIEW.value,
        )
        .order_by(models.Site.legal_review_at.asc())
    )
    rows = (await session.execute(stmt)).all()

    items: list[LegalQueueItem] = []
    for site, review in rows:
        submitted_by_name = await fetch_user_name(session, site.submitted_by)
        items.append(LegalQueueItem(
            site_id=str(site.id),
            site_code=site.code or "",
            site_name=site.name,
            city=site.city,
            legal_review_id=str(review.id),
            review_status=review.status,
            legal_review_at=site.legal_review_at,
            submitted_by_name=submitted_by_name,
        ))

    return LegalQueueResponse(items=items, total=len(items))


async def svc_get_legal_review(
    session: AsyncSession, *, site_id: str | UUID, tenant_id: str | UUID,
) -> LegalReviewResponse:
    review = await _fetch_review_or_404(session, site_id=site_id, tenant_id=tenant_id)
    return _review_to_response(review)


# ── Step 1 · Verification Checklist ──────────────────────────────────────────

async def svc_save_verification(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: SaveVerificationRequest,
) -> LegalReviewResponse:
    async with transaction(session):
        review = await _fetch_review_or_404(session, site_id=site_id, tenant_id=tenant_id)

        if review.status not in ("pending", "verification_saved"):
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Cannot save verification at review status '{review.status}'",
            )

        review.reviewer_id = actor["sub"]
        review.title_check = body.title_check
        review.sanctioned_plan_check = body.sanctioned_plan_check
        review.oc_cc_check = body.oc_cc_check
        review.commercial_uses_check = body.commercial_uses_check
        review.property_tax_check = body.property_tax_check
        review.electricity_check = body.electricity_check
        review.fire_noc_verification_check = body.fire_noc_verification_check
        review.status = "verification_saved"
        review.verification_completed_at = datetime.now(timezone.utc)

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site_id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="legal_save_verification",
            detail="Verification checklist saved",
        )

    return _review_to_response(review)


# ── Step 2 · Due Diligence ────────────────────────────────────────────────────

async def svc_save_due_diligence(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: SaveDueDiligenceRequest,
) -> LegalReviewResponse:
    if body.due_diligence_status not in ("positive", "negative"):
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="due_diligence_status must be 'positive' or 'negative'",
        )
    if body.due_diligence_status == "negative" and not body.rejection_reason:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="rejection_reason is required when due_diligence_status is 'negative'",
        )

    async with transaction(session):
        review = await _fetch_review_or_404(session, site_id=site_id, tenant_id=tenant_id)

        if review.status != "verification_saved":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Complete the verification checklist (Step 1) before submitting Due Diligence",
            )

        review.due_diligence_status = body.due_diligence_status
        review.rejection_reason = body.rejection_reason
        review.due_diligence_completed_at = datetime.now(timezone.utc)

        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)

        if body.due_diligence_status == "negative":
            # ── Reject path ─────────────────────────────────────────────────
            review.status = "rejected"
            review.completed_at = datetime.now(timezone.utc)

            assert_transition(SiteStatus(site.status), SiteStatus.LEGAL_REJECTED)
            site.status = SiteStatus.LEGAL_REJECTED.value
            site.legal_rejected_at = datetime.now(timezone.utc)

            await write_audit_event(
                session, tenant_id=tenant_id, site_id=site_id,
                actor_id=actor["sub"], actor_name=actor["name"],
                action="legal_reject",
                from_status=SiteStatus.LEGAL_REVIEW.value,
                to_status=SiteStatus.LEGAL_REJECTED.value,
                detail=f"Negative DD: {body.rejection_reason}",
            )
            # Notify the BD executive + supervisor who submitted the site
            bd_recipients = await recipients_for_site_owner(session, site=site)
            await notify_enqueue(
                session, tenant_id=tenant_id, event="legal_rejected",
                recipient_ids=bd_recipients, site_id=site_id,
                channels=("email", "in_app"),
                payload={
                    "site_id": str(site_id),
                    "site_name": site.name,
                    "rejection_reason": body.rejection_reason,
                },
                subject=f"Legal rejected: {site.name}",
                body=(
                    f"The site '{site.name}' ({site.code}) has been rejected by the Legal "
                    f"team after Due Diligence.\n\nReason: {body.rejection_reason}"
                ),
            )
        else:
            # ── Positive path ────────────────────────────────────────────────
            review.status = "due_diligence_done"
            await write_audit_event(
                session, tenant_id=tenant_id, site_id=site_id,
                actor_id=actor["sub"], actor_name=actor["name"],
                action="legal_due_diligence_positive",
                detail="Positive DD — proceeding to Agreement",
            )

    return _review_to_response(review)


# ── Step 3 · Agreement ────────────────────────────────────────────────────────

async def svc_save_agreement(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: SaveAgreementRequest,
) -> LegalReviewResponse:
    async with transaction(session):
        review = await _fetch_review_or_404(session, site_id=site_id, tenant_id=tenant_id)

        if review.status != "due_diligence_done":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Complete Due Diligence with a positive result (Step 2) before saving Agreement",
            )

        review.agreement_signed = body.agreement_signed
        review.agreement_registered = body.agreement_registered
        review.status = "agreement_done"
        review.agreement_completed_at = datetime.now(timezone.utc)

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site_id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="legal_save_agreement",
            detail=f"Signed={body.agreement_signed} Registered={body.agreement_registered}",
        )

    return _review_to_response(review)


# ── Step 4 · Licensing → auto-approve ────────────────────────────────────────

async def svc_save_licensing(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: SaveLicensingRequest,
) -> LegalReviewResponse:
    async with transaction(session):
        review = await _fetch_review_or_404(session, site_id=site_id, tenant_id=tenant_id)

        if review.status != "agreement_done":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Complete the Agreement section (Step 3) before saving Licensing",
            )

        review.fssai_check = body.fssai_check
        review.health_trade_license_check = body.health_trade_license_check
        review.shops_license_check = body.shops_license_check
        review.fire_noc_licensing_check = body.fire_noc_licensing_check
        review.storage_license_check = body.storage_license_check
        review.status = "approved"
        review.licensing_completed_at = datetime.now(timezone.utc)
        review.completed_at = datetime.now(timezone.utc)

        # Auto-approve: transition site LEGAL_REVIEW → LEGAL_APPROVED
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        assert_transition(SiteStatus(site.status), SiteStatus.LEGAL_APPROVED)
        site.status = SiteStatus.LEGAL_APPROVED.value
        site.legal_approved_at = datetime.now(timezone.utc)

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site_id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="legal_approve",
            from_status=SiteStatus.LEGAL_REVIEW.value,
            to_status=SiteStatus.LEGAL_APPROVED.value,
            detail="All 4 checklist steps completed — Legal Approved",
        )

        # Notify BD executive/supervisor that legal cleared the site
        bd_recipients = await recipients_for_site_owner(session, site=site)
        await notify_enqueue(
            session, tenant_id=tenant_id, event="legal_approved",
            recipient_ids=bd_recipients, site_id=site_id,
            channels=("email", "in_app"),
            payload={"site_id": str(site_id), "site_name": site.name},
            subject=f"Legal approved: {site.name}",
            body=(
                f"The site '{site.name}' ({site.code}) has been fully cleared by the Legal "
                f"team and is now ready for the Payments module."
            ),
        )

    return _review_to_response(review)
