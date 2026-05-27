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
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

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
        final_verdict=dd.final_verdict,
        rejection_reason=dd.rejection_reason,
        reviewed_by=str(dd.reviewed_by) if dd.reviewed_by else None,
        approved_by=str(dd.approved_by) if dd.approved_by else None,
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
        updated_at=lic.updated_at,
    )


async def _build_review_response(
    session: AsyncSession, site: models.Site,
) -> LegalReviewResponse:
    dd  = await _fetch_dd_or_none(session, site_id=site.id)
    ag  = await _fetch_agreement_or_none(session, site_id=site.id)
    lic = await _fetch_licensing_or_none(session, site_id=site.id)
    return LegalReviewResponse(
        site_id=str(site.id),
        tenant_id=str(site.tenant_id),
        site_status=site.status,
        legal_dd_status=site.legal_dd_status,
        agreement_status=site.agreement_status,
        licensing_status=site.licensing_status,
        dd=_dd_to_response(dd) if dd else None,
        agreement=_agreement_to_response(ag) if ag else None,
        licensing=_licensing_to_response(lic) if lic else None,
    )


# ── Queue ─────────────────────────────────────────────────────────────────────

async def svc_legal_queue(
    session: AsyncSession, *, tenant_id: str | UUID,
) -> LegalQueueResponse:
    """Return all sites currently in LEGAL_REVIEW with their DD checklist status."""
    stmt = (
        select(models.Site)
        .where(
            models.Site.tenant_id == tenant_id,
            models.Site.status == SiteStatus.LEGAL_REVIEW.value,
        )
        .order_by(models.Site.legal_review_at.asc())
    )
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
    """Create or update the DD checklist row; set sites.legal_dd_status = 'in_review'."""
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)

        if site.status != SiteStatus.LEGAL_REVIEW.value:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Site is not in legal_review (current: {site.status})",
            )

        dd = await _fetch_dd_or_none(session, site_id=site.id)
        if dd is None:
            dd = models.LegalDdChecklist(site_id=site.id)
            session.add(dd)

        # Only overwrite fields that were explicitly supplied
        for field in (
            "title_doc", "sanctioned_plan", "oc_cc", "commercial_use",
            "property_tax", "electricity", "fire_noc", "other_1", "other_2",
        ):
            val = getattr(body, field)
            if val is not None:
                setattr(dd, field, val)

        dd.reviewed_by = actor["sub"]

        # Mirror to sites
        site.legal_dd_status = "in_review"

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="legal_dd_items_saved",
            detail="DD checklist items updated",
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

        if site.status != SiteStatus.LEGAL_REVIEW.value:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Site is not in legal_review (current: {site.status})",
            )

        dd.final_verdict   = body.final_verdict
        dd.rejection_reason = body.rejection_reason
        dd.approved_by     = actor["sub"]

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

            # The same legal delegate inherits licensing automatically: one
            # `site_delegations` row covers both DD and licensing under
            # module='legal'. Wrapped in a SAVEPOINT (see helper) so a missing
            # site_delegations table (slice U2 not yet shipped) is a silent
            # no-op rather than a failed finalize.
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

    Slice U2 introduces `site_delegations`. Until that migration lands the
    table doesn't exist, so we run the lookup inside a SAVEPOINT and swallow
    SQLAlchemyError — the outer transaction stays clean and the caller falls
    back to "no delegate".
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

    When all five items are 'yes':
      - sites.licensing_status → 'complete'
      - sites.status → LEGAL_APPROVED (legal workflow done)
      - BD notified via email + in_app
    """
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        ag   = await _fetch_agreement_or_none(session, site_id=site.id)

        if ag is None or not ag.registered:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Agreement must be registered (Step 3) before saving Licensing",
            )

        lic = await _fetch_licensing_or_none(session, site_id=site.id)
        if lic is None:
            lic = models.SiteLicensing(site_id=site.id)
            session.add(lic)

        for field in ("fssai", "health_trade", "shops_estab_reg", "fire_noc", "storage_license"):
            val = getattr(body, field)
            if val is not None:
                setattr(lic, field, val)

        # Check if all five are now 'yes'
        all_done = all(
            getattr(lic, f) == "yes"
            for f in ("fssai", "health_trade", "shops_estab_reg", "fire_noc", "storage_license")
        )

        if all_done:
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
