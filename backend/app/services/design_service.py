"""Design Department workflow service.

A PARALLEL track that opens once a site's DDR is positive
(sites.legal_dd_status == 'positive'). It does NOT mutate the linear site status
(state_machine.py is untouched) — progress is tracked by:

  sites.design_status   — mirror column BD/dashboards read
  design_reviews         — one row per site (active stage + business_admin GFC gate)
  design_deliverables    — one row per (site, kind): recce | 2d | 3d | boq

Swimlane:
  Supervisor allocates a DDR-positive site to a *design* executive (separate pool,
  module='design'). The executive uploads each deliverable; the supervisor reviews
  it yes/no with comments (reject → re-upload loop). When the BOQ is approved the
  site reaches the GFC gate, where the **business_admin** gives the final
  Good-For-Construction approval (a comments dialog visible to the supervisor).

Mirror column sites.design_status:
  pending | allocated | in_progress | gfc_pending | approved | rejected
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.db.session import transaction
from app.domain.schemas.common import OkResponse
from app.domain.schemas.design import (
    DeliverableResponse,
    DesignGfcQueueItem,
    DesignGfcQueueResponse,
    DesignQueueItem,
    DesignQueueResponse,
    DesignReviewResponse,
    GfcDecisionRequest,
    ReviewDeliverableRequest,
    SubmitDeliverableRequest,
)
from app.services._common import fetch_site_or_404, fetch_user_name
from app.services.audit_service import write_audit_event
from app.services.delegation_service import svc_is_delegated
from app.services.notification_service import (
    enqueue as notify_enqueue,
    recipients_for_business_admins,
    recipients_for_design_supervisors,
)

logger = logging.getLogger(__name__)

# Deliverable order + the supervisor-approval advance map.
# Approving the BOQ advances current_stage to 'gfc' (the business_admin gate).
_KIND_ORDER = {"recce": 0, "2d": 1, "3d": 2, "boq": 3}
_NEXT_STAGE = {"recce": "2d", "2d": "3d", "3d": "boq", "boq": "gfc"}
_DELIVERABLE_KINDS = ("recce", "2d", "3d", "boq")


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _fetch_review_or_none(
    session: AsyncSession, *, site_id: str | UUID,
) -> Optional[models.DesignReview]:
    return (await session.execute(
        select(models.DesignReview).where(models.DesignReview.site_id == site_id)
    )).scalar_one_or_none()


async def _fetch_review_or_404(
    session: AsyncSession, *, site_id: str | UUID,
) -> models.DesignReview:
    row = await _fetch_review_or_none(session, site_id=site_id)
    if row is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail=(
                f"No design review found for site {site_id}. "
                "A supervisor must allocate the site to a design executive first."
            ),
        )
    return row


async def _fetch_deliverables(
    session: AsyncSession, *, site_id: str | UUID,
) -> list[models.DesignDeliverable]:
    rows = (await session.execute(
        select(models.DesignDeliverable).where(models.DesignDeliverable.site_id == site_id)
    )).scalars().all()
    return sorted(rows, key=lambda d: _KIND_ORDER.get(d.kind, 99))


async def _fetch_deliverable_or_none(
    session: AsyncSession, *, site_id: str | UUID, kind: str,
) -> Optional[models.DesignDeliverable]:
    return (await session.execute(
        select(models.DesignDeliverable).where(
            models.DesignDeliverable.site_id == site_id,
            models.DesignDeliverable.kind == kind,
        )
    )).scalar_one_or_none()


async def _active_design_delegate(
    session: AsyncSession, *, site_id: str | UUID,
) -> Optional[tuple[UUID, str, str]]:
    """Return (user_id, name, email) of the current design delegate, or None."""
    row = (await session.execute(
        select(models.SiteDelegation.delegate_user_id, models.User.name, models.User.email)
        .join(models.User, models.User.id == models.SiteDelegation.delegate_user_id)
        .where(
            models.SiteDelegation.site_id == site_id,
            models.SiteDelegation.module == "design",
            models.SiteDelegation.revoked_at.is_(None),
        )
        .order_by(models.SiteDelegation.granted_at.desc())
        .limit(1)
    )).first()
    return (row[0], row[1], row[2]) if row else None


def _deliverable_to_response(d: models.DesignDeliverable) -> DeliverableResponse:
    return DeliverableResponse(
        kind=d.kind,
        status=d.status,
        file_url=d.file_url,
        file_name=d.file_name,
        estimated_amount=float(d.estimated_amount) if d.estimated_amount is not None else None,
        supervisor_comments=d.supervisor_comments,
        submitted_by=str(d.submitted_by) if d.submitted_by else None,
        submitted_at=d.submitted_at,
        reviewed_by=str(d.reviewed_by) if d.reviewed_by else None,
        reviewed_at=d.reviewed_at,
        updated_at=d.updated_at,
    )


async def _build_design_response(
    session: AsyncSession, site: models.Site,
) -> DesignReviewResponse:
    review = await _fetch_review_or_none(session, site_id=site.id)
    deliverables = await _fetch_deliverables(session, site_id=site.id)
    submitted_by_name = await fetch_user_name(session, site.submitted_by)
    return DesignReviewResponse(
        site_id=str(site.id),
        site_code=site.code or "",
        site_name=site.name,
        city=site.city,
        submitted_by_name=submitted_by_name,
        tenant_id=str(site.tenant_id),
        site_status=site.status,
        design_status=site.design_status or "pending",
        legal_dd_status=site.legal_dd_status,
        current_stage=(review.current_stage if review else "recce"),
        gfc_status=(review.gfc_status if review else "pending"),
        gfc_comments=(review.gfc_comments if review else None),
        gfc_decided_at=(review.gfc_decided_at if review else None),
        deliverables=[_deliverable_to_response(d) for d in deliverables],
    )


def _assert_ddr_positive(site: models.Site) -> None:
    """The design module only opens once DDR is positive."""
    if (site.legal_dd_status or "pending") != "positive":
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Design is gated on a positive DDR. Site legal_dd_status is "
                f"'{site.legal_dd_status}', not 'positive'."
            ),
        )


# ── Queue ─────────────────────────────────────────────────────────────────────

async def svc_design_queue(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    restrict_to_site_ids: Optional[list[str]] = None,
) -> DesignQueueResponse:
    """DDR-positive sites that are still active in design (design_status != approved).

    `restrict_to_site_ids` is the additive filter the router passes for an
    executive caller (so they only see sites delegated to them). None = the
    supervisor-wide view.
    """
    stmt = (
        select(models.Site)
        .where(
            models.Site.tenant_id == tenant_id,
            models.Site.legal_dd_status == "positive",
            models.Site.design_status != "approved",
        )
        .order_by(models.Site.updated_at.asc())
    )
    if restrict_to_site_ids is not None:
        if not restrict_to_site_ids:
            return DesignQueueResponse(items=[], total=0)
        stmt = stmt.where(models.Site.id.in_(restrict_to_site_ids))

    sites = (await session.execute(stmt)).scalars().all()

    items: list[DesignQueueItem] = []
    for site in sites:
        review = await _fetch_review_or_none(session, site_id=site.id)
        delegate = await _active_design_delegate(session, site_id=site.id)
        submitted_by_name = await fetch_user_name(session, site.submitted_by)
        items.append(DesignQueueItem(
            site_id=str(site.id),
            site_code=site.code or "",
            site_name=site.name,
            city=site.city,
            design_status=site.design_status or "pending",
            current_stage=(review.current_stage if review else None),
            legal_dd_status=site.legal_dd_status or "pending",
            allocated_to_name=(delegate[1] if delegate else None),
            submitted_by_name=submitted_by_name,
        ))
    return DesignQueueResponse(items=items, total=len(items))


async def svc_get_design_review(
    session: AsyncSession, *, site_id: str | UUID, tenant_id: str | UUID,
) -> DesignReviewResponse:
    site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
    return await _build_design_response(session, site)


# ── Allocation (supervisor → design executive) ───────────────────────────────

async def svc_allocate_design(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    delegate_user_id: str | UUID,
    notes: Optional[str] = None,
) -> DesignReviewResponse:
    """Supervisor allocates a DDR-positive site to a design executive.

    Creates a site_delegations row (module='design'), opens the design_reviews
    row at stage 'recce', and mirrors sites.design_status = 'allocated'.
    """
    if (actor.get("role") or "").lower() != "supervisor":
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Only a supervisor can allocate a design site.",
        )
    if str(delegate_user_id) == str(actor["sub"]):
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Cannot allocate to yourself.",
        )

    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        _assert_ddr_positive(site)

        delegate = (await session.execute(
            select(models.User).where(
                models.User.id == delegate_user_id,
                models.User.tenant_id == tenant_id,
                models.User.is_active.is_(True),
            )
        )).scalar_one_or_none()
        if delegate is None:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="Delegate user not found in this workspace, or not active.",
            )
        # Design executives are a separate pool, but at the user level they are
        # still role='executive' (module='design' is the discriminator). The UI
        # scopes the candidate list to design-module execs; here we only assert
        # the coarse role, mirroring the Legal allocation guard.
        if (delegate.role or "").lower() != "executive":
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Sites can only be allocated to executive users.",
            )

        existing = (await session.execute(
            select(models.SiteDelegation).where(
                models.SiteDelegation.site_id == site.id,
                models.SiteDelegation.module == "design",
                models.SiteDelegation.delegate_user_id == delegate_user_id,
                models.SiteDelegation.revoked_at.is_(None),
            )
        )).scalar_one_or_none()
        if existing is not None:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail="An active design allocation for this site + user already exists.",
            )

        row = models.SiteDelegation(
            tenant_id=tenant_id,
            site_id=site.id,
            module="design",
            delegate_user_id=delegate_user_id,
            granted_by=actor["sub"],
            notes=(notes or "").strip() or None,
        )
        session.add(row)

        review = await _fetch_review_or_none(session, site_id=site.id)
        if review is None:
            review = models.DesignReview(
                site_id=site.id, tenant_id=tenant_id, current_stage="recce",
            )
            session.add(review)
        review.reviewed_by = delegate.id

        if (site.design_status or "pending") in ("pending", "allocated"):
            site.design_status = "allocated"

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="design_allocated",
            entity_id=row.id, entity_type="site_delegation",
            detail=f"delegate={delegate.email} notes={row.notes or ''}",
        )
        await notify_enqueue(
            session, tenant_id=tenant_id, event="design_allocated",
            recipient_ids=[delegate.id], site_id=site.id,
            channels=("in_app", "email"),
            payload={"site_id": str(site.id), "site_name": site.name, "module": "design"},
            subject=f"Design site allocated: {site.name}",
            body=(
                f"You have been allocated design responsibility for '{site.name}' "
                f"({site.code}). Open the Design queue and upload the Recce to begin."
            ),
        )

    return await _build_design_response(session, site)


async def svc_list_design_delegations_for_site(
    session: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID,
) -> dict:
    """Active design allocations for a single site (supervisor view)."""
    try:
        stmt = (
            select(models.SiteDelegation, models.User.email, models.User.name)
            .join(models.User, models.User.id == models.SiteDelegation.delegate_user_id)
            .where(
                models.SiteDelegation.site_id == site_id,
                models.SiteDelegation.tenant_id == tenant_id,
                models.SiteDelegation.module == "design",
                models.SiteDelegation.revoked_at.is_(None),
            )
            .order_by(models.SiteDelegation.granted_at.desc())
        )
        rows = (await session.execute(stmt)).all()
    except Exception:
        return {"items": [], "total": 0}
    return {
        "items": [
            {
                "id": str(d.id),
                "site_id": str(d.site_id),
                "module": d.module,
                "delegate_user_id": str(d.delegate_user_id),
                "delegate_email": email,
                "delegate_name": name,
                "granted_by": str(d.granted_by),
                "granted_at": d.granted_at.isoformat() if d.granted_at else None,
                "notes": d.notes,
            }
            for (d, email, name) in rows
        ],
        "total": len(rows),
    }


async def svc_revoke_design_delegation(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    delegate_user_id: str | UUID,
) -> OkResponse:
    """Supervisor revokes an active design allocation by (site, user). Idempotent."""
    if (actor.get("role") or "").lower() != "supervisor":
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Only a supervisor can revoke a design allocation.",
        )
    async with transaction(session):
        row = (await session.execute(
            select(models.SiteDelegation).where(
                models.SiteDelegation.tenant_id == tenant_id,
                models.SiteDelegation.site_id == site_id,
                models.SiteDelegation.module == "design",
                models.SiteDelegation.delegate_user_id == delegate_user_id,
                models.SiteDelegation.revoked_at.is_(None),
            )
        )).scalar_one_or_none()
        if row is None:
            return OkResponse(message="No active design allocation to revoke.")
        row.revoked_at = datetime.now(timezone.utc)
        row.revoked_by = actor["sub"]
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=row.site_id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="design_delegation_revoked",
            entity_id=row.id, entity_type="site_delegation",
        )
    return OkResponse(message="Design allocation revoked.")


# ── Executive: submit a deliverable (recce / 2d / 3d / boq) ───────────────────

async def _advance_stage_after_approval(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site: models.Site,
    review: models.DesignReview,
    kind: str,
) -> None:
    """Advance current_stage after a deliverable is approved — whether by a
    supervisor reviewing an executive's upload, or by a supervisor handling the
    site directly. recce→2d→3d→boq→gfc. Approving the BOQ opens the GFC gate
    (design_status='gfc_pending') and notifies the business admins.
    """
    next_stage = _NEXT_STAGE[kind]
    review.current_stage = next_stage
    review.approved_by = actor["sub"]

    if next_stage == "gfc":
        site.design_status = "gfc_pending"
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="design_boq_approved",
            detail="BOQ approved — site moved to GFC gate (awaiting admin)",
        )
        admins = await recipients_for_business_admins(session, tenant_id=tenant_id)
        if admins:
            await notify_enqueue(
                session, tenant_id=tenant_id, event="design_gfc_pending",
                recipient_ids=admins, site_id=site.id,
                channels=("in_app", "email"),
                payload={"site_id": str(site.id), "site_name": site.name},
                subject=f"GFC approval needed: {site.name}",
                body=(
                    f"The design package for '{site.name}' ({site.code}) is ready. "
                    f"Open the Design tab to give Good-For-Construction approval."
                ),
            )
    else:
        site.design_status = "in_progress"
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="design_deliverable_approved",
            detail=f"kind={kind} → next stage '{next_stage}'",
        )
        delegate = await _active_design_delegate(session, site_id=site.id)
        if delegate:
            await notify_enqueue(
                session, tenant_id=tenant_id, event="design_deliverable_approved",
                recipient_ids=[delegate[0]], site_id=site.id,
                channels=("in_app",),
                payload={"site_id": str(site.id), "site_name": site.name,
                         "kind": kind, "next_stage": next_stage},
                subject=f"{kind} approved: {site.name}",
                body=(
                    f"Your {kind} for '{site.name}' was approved. "
                    f"Next deliverable: {next_stage}."
                ),
            )


async def svc_submit_deliverable(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    kind: str,
    body: SubmitDeliverableRequest,
) -> DesignReviewResponse:
    """Submit (upload / re-upload) the deliverable for the active stage.

    - Executive (delegated): flips the row to 'submitted' and notifies the design
      supervisors for review.
    - Supervisor handling the site directly (no executive): the upload is the
      authority, so it is auto-approved and the stage advances — the only
      remaining gate is the admin's GFC. The design_reviews row is created
      lazily on the supervisor's first upload, so no allocation is required.
    """
    if kind not in _DELIVERABLE_KINDS:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown deliverable kind: {kind!r}",
        )

    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        _assert_ddr_positive(site)
        is_supervisor = (actor.get("role") or "").lower() == "supervisor"
        review = await _fetch_review_or_none(session, site_id=site.id)
        if review is None:
            if is_supervisor:
                # Supervisor handles the site directly (no executive). Open the
                # design folder lazily on their first upload — no allocation needed.
                review = models.DesignReview(
                    site_id=site.id, tenant_id=tenant_id, current_stage="recce",
                )
                session.add(review)
                await session.flush()
            else:
                raise HTTPException(
                    status_code=http_status.HTTP_404_NOT_FOUND,
                    detail=(
                        f"No design review found for site {site_id}. A supervisor must "
                        "allocate the site (or handle it directly) before uploads."
                    ),
                )

        # Executives must hold an active design allocation; supervisors are free.
        if not is_supervisor:
            ok = await svc_is_delegated(
                session, tenant_id=tenant_id, site_id=site.id,
                user_id=actor["sub"], module="design",
            )
            if not ok:
                raise HTTPException(
                    status_code=http_status.HTTP_403_FORBIDDEN,
                    detail=(
                        "You do not have an active design allocation on this site. "
                        "Ask the design supervisor to allocate it to you first."
                    ),
                )

        if review.current_stage != kind:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"'{kind}' is not the active deliverable for this site "
                    f"(current stage: '{review.current_stage}')."
                ),
            )

        deliverable = await _fetch_deliverable_or_none(session, site_id=site.id, kind=kind)
        if deliverable is None:
            deliverable = models.DesignDeliverable(
                tenant_id=tenant_id, site_id=site.id, kind=kind,
            )
            session.add(deliverable)
        elif deliverable.status == "approved":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"The {kind} deliverable is already approved.",
            )

        if body.file_url is not None:
            deliverable.file_url = body.file_url
        if body.file_name is not None:
            deliverable.file_name = body.file_name
        if kind == "boq" and body.estimated_amount is not None:
            deliverable.estimated_amount = body.estimated_amount

        now = datetime.now(timezone.utc)
        deliverable.submitted_by = actor["sub"]
        deliverable.submitted_at = now
        if (site.design_status or "pending") in ("pending", "allocated"):
            site.design_status = "in_progress"

        if is_supervisor:
            # Supervisor self-handle: their upload IS the authority — auto-approve
            # and advance. The only remaining gate is the admin's GFC, so every
            # approval is between the supervisor and the admin.
            deliverable.status = "approved"
            deliverable.reviewed_by = actor["sub"]
            deliverable.reviewed_at = now
            deliverable.supervisor_comments = None
            await write_audit_event(
                session, tenant_id=tenant_id, site_id=site.id,
                actor_id=actor["sub"], actor_name=actor.get("name"),
                action="design_deliverable_self_uploaded",
                detail=f"kind={kind} (supervisor handled directly — auto-approved)",
            )
            await _advance_stage_after_approval(
                session, tenant_id=tenant_id, actor=actor, site=site, review=review, kind=kind,
            )
        else:
            deliverable.status = "submitted"
            deliverable.supervisor_comments = None  # clear any prior rejection note
            deliverable.reviewed_by = None
            deliverable.reviewed_at = None
            review.reviewed_by = actor["sub"]
            await write_audit_event(
                session, tenant_id=tenant_id, site_id=site.id,
                actor_id=actor["sub"], actor_name=actor.get("name"),
                action="design_deliverable_submitted",
                detail=f"kind={kind}",
            )
            supervisors = await recipients_for_design_supervisors(session, tenant_id=tenant_id)
            if supervisors:
                await notify_enqueue(
                    session, tenant_id=tenant_id, event="design_deliverable_submitted",
                    recipient_ids=supervisors, site_id=site.id,
                    channels=("in_app",),
                    payload={"site_id": str(site.id), "site_name": site.name, "kind": kind},
                    subject=f"Design review pending ({kind}): {site.name}",
                    body=(
                        f"{actor.get('name') or 'A design executive'} submitted the {kind} "
                        f"deliverable for '{site.name}' ({site.code}). It awaits your review."
                    ),
                )

    return await _build_design_response(session, site)


# ── Supervisor: review a deliverable (approve / reject + comments) ────────────

async def svc_review_deliverable(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    kind: str,
    body: ReviewDeliverableRequest,
) -> DesignReviewResponse:
    """Supervisor approves or rejects the submitted deliverable.

    approve → advance current_stage (recce→2d→3d→boq→gfc). Approving the BOQ moves
             the site to the GFC gate (design_status='gfc_pending') and notifies
             the business_admins.
    reject  → store comments (visible to the executive); executive re-uploads.
    """
    if (actor.get("role") or "").lower() != "supervisor":
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Only a supervisor can review a design deliverable.",
        )
    if kind not in _DELIVERABLE_KINDS:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown deliverable kind: {kind!r}",
        )

    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        review = await _fetch_review_or_404(session, site_id=site.id)
        deliverable = await _fetch_deliverable_or_none(session, site_id=site.id, kind=kind)

        if deliverable is None or deliverable.status != "submitted":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"No submitted {kind} deliverable to review.",
            )
        if review.current_stage != kind:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"'{kind}' is not the active stage (current: '{review.current_stage}')."
                ),
            )

        now = datetime.now(timezone.utc)
        deliverable.reviewed_by = actor["sub"]
        deliverable.reviewed_at = now
        review.approved_by = actor["sub"]
        delegate = await _active_design_delegate(session, site_id=site.id)

        if body.decision == "approve":
            deliverable.status = "approved"
            deliverable.supervisor_comments = (body.comments or "").strip() or None
            await _advance_stage_after_approval(
                session, tenant_id=tenant_id, actor=actor, site=site, review=review, kind=kind,
            )
        else:
            # ── Reject → comments visible to the executive, re-upload loop ──
            deliverable.status = "rejected"
            deliverable.supervisor_comments = (body.comments or "").strip() or None
            site.design_status = "in_progress"
            await write_audit_event(
                session, tenant_id=tenant_id, site_id=site.id,
                actor_id=actor["sub"], actor_name=actor.get("name"),
                action="design_deliverable_rejected",
                detail=f"kind={kind}: {deliverable.supervisor_comments or ''}",
            )
            if delegate:
                await notify_enqueue(
                    session, tenant_id=tenant_id, event="design_deliverable_rejected",
                    recipient_ids=[delegate[0]], site_id=site.id,
                    channels=("in_app", "email"),
                    payload={"site_id": str(site.id), "site_name": site.name,
                             "kind": kind, "comments": deliverable.supervisor_comments},
                    subject=f"{kind} needs changes: {site.name}",
                    body=(
                        f"Your {kind} for '{site.name}' was sent back.\n\n"
                        f"Supervisor comments: {deliverable.supervisor_comments or '(none)'}"
                    ),
                )

    return await _build_design_response(session, site)


# ── Business admin: GFC gate ──────────────────────────────────────────────────

async def svc_design_gfc_queue(
    session: AsyncSession, *, tenant_id: str | UUID,
) -> DesignGfcQueueResponse:
    """Sites awaiting the business_admin's Good-For-Construction approval."""
    stmt = (
        select(models.Site)
        .where(
            models.Site.tenant_id == tenant_id,
            models.Site.design_status == "gfc_pending",
        )
        .order_by(models.Site.updated_at.asc())
    )
    sites = (await session.execute(stmt)).scalars().all()

    items: list[DesignGfcQueueItem] = []
    for site in sites:
        boq = await _fetch_deliverable_or_none(session, site_id=site.id, kind="boq")
        submitted_by_name = await fetch_user_name(session, site.submitted_by)
        items.append(DesignGfcQueueItem(
            site_id=str(site.id),
            site_code=site.code or "",
            site_name=site.name,
            city=site.city,
            boq_estimated_amount=(
                float(boq.estimated_amount)
                if (boq and boq.estimated_amount is not None) else None
            ),
            submitted_by_name=submitted_by_name,
        ))
    return DesignGfcQueueResponse(items=items, total=len(items))


async def svc_gfc_decision(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: GfcDecisionRequest,
) -> DesignReviewResponse:
    """Business admin's Good-For-Construction decision (the admin gate).

    approve → design complete: design_status='approved', current_stage='done'.
    reject  → bounce to BOQ revision: design_status='in_progress', stage='boq',
              admin comments surfaced to the supervisor (and onto the BOQ row).
    """
    if (actor.get("role") or "").lower() != "business_admin":
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Only a business admin can decide GFC approval.",
        )

    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        review = await _fetch_review_or_404(session, site_id=site.id)

        if (site.design_status != "gfc_pending") or (review.current_stage != "gfc"):
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Site is not awaiting GFC (design_status='{site.design_status}', "
                    f"stage='{review.current_stage}')."
                ),
            )

        now = datetime.now(timezone.utc)
        review.gfc_decided_by = actor["sub"]
        review.gfc_decided_at = now
        review.gfc_comments = (body.comments or "").strip() or None
        supervisors = await recipients_for_design_supervisors(session, tenant_id=tenant_id)

        if body.decision == "approve":
            review.gfc_status = "approved"
            review.current_stage = "done"
            site.design_status = "approved"
            site.design_approved_at = now
            await write_audit_event(
                session, tenant_id=tenant_id, site_id=site.id,
                actor_id=actor["sub"], actor_name=actor.get("name"),
                action="design_gfc_approved",
                detail="GFC approved — design complete",
            )
            if supervisors:
                await notify_enqueue(
                    session, tenant_id=tenant_id, event="design_gfc_approved",
                    recipient_ids=supervisors, site_id=site.id,
                    channels=("in_app", "email"),
                    payload={"site_id": str(site.id), "site_name": site.name},
                    subject=f"GFC approved: {site.name}",
                    body=(
                        f"'{site.name}' ({site.code}) received Good-For-Construction "
                        f"approval. The design module is complete."
                    ),
                )
        else:
            review.gfc_status = "rejected"
            review.current_stage = "boq"
            site.design_status = "in_progress"
            boq = await _fetch_deliverable_or_none(session, site_id=site.id, kind="boq")
            if boq is not None:
                boq.status = "rejected"
                boq.supervisor_comments = f"GFC rejected by admin: {review.gfc_comments or ''}"
            await write_audit_event(
                session, tenant_id=tenant_id, site_id=site.id,
                actor_id=actor["sub"], actor_name=actor.get("name"),
                action="design_gfc_rejected",
                detail=review.gfc_comments or "",
            )
            if supervisors:
                await notify_enqueue(
                    session, tenant_id=tenant_id, event="design_gfc_rejected",
                    recipient_ids=supervisors, site_id=site.id,
                    channels=("in_app", "email"),
                    payload={"site_id": str(site.id), "site_name": site.name,
                             "comments": review.gfc_comments},
                    subject=f"GFC sent back: {site.name}",
                    body=(
                        f"The GFC for '{site.name}' ({site.code}) was sent back by the admin.\n\n"
                        f"Comments: {review.gfc_comments or '(none)'}"
                    ),
                )

    return await _build_design_response(session, site)
