"""Design Department workflow service.

A PARALLEL track that opens once a site's DDR is positive and Finance admin
approval is complete
(sites.legal_dd_status == 'positive', sites.finance_status == 'approved').
It does NOT depend on the linear site status — progress is tracked by:

  sites.design_status   — mirror column BD/dashboards read
  design_reviews         — one row per site (active stage + business_admin GFC gate)
  design_deliverables    — one row per (site, kind): recce | 2d | 3d | boq

Swimlane:
  Supervisor allocates a finance-approved site to a *design* executive (separate
  pool, module='design'). The executive uploads each deliverable; the supervisor
  reviews it yes/no with comments (reject → re-upload loop). After 3D is
  approved the site reaches the GFC gate, where the **business_admin** gives
  Good-For-Construction approval. Once GFC passes, the executive uploads the
  BOQ + estimate; supervisor approval sends the BOQ to business_admin for the
  final Design-completion gate.

  Stage order: recce → 2d → 3d → GFC gate → boq → done

Mirror column sites.design_status:
  pending | allocated | in_progress | gfc_pending | approved | rejected
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.db.session import transaction
from app.domain.schemas.common import OkResponse
from app.domain.schemas.design import (
    AdminQueueDeliverable,
    AdminReviewDeliverableRequest,
    DeliverableResponse,
    DesignAdminQueueResponse,
    DesignAdminQueueSite,
    DesignGfcQueueItem,
    DesignGfcQueueResponse,
    DesignHistoryItem,
    DesignHistoryResponse,
    DesignQueueItem,
    DesignQueueResponse,
    DesignReviewResponse,
    GfcDecisionRequest,
    ReviewDeliverableRequest,
    SubmitDeliverableRequest,
)
from app.services.storage_service import signed_url as storage_signed_url
from app.services._common import count_rows, fetch_site_or_404, fetch_user_name, fetch_user_names
from app.services.audit_service import write_audit_event
from app.services.delegation_service import svc_is_delegated
from app.services import budget_service
from app.services.notification_service import (
    enqueue as notify_enqueue,
    recipients_for_business_admins,
    recipients_for_design_supervisors,
    recipients_for_module_supervisors,
)

logger = logging.getLogger(__name__)

# Deliverable order + the supervisor-approval advance map.
# Approving 3D advances current_stage to 'gfc' (the business_admin GFC gate).
# GFC approval now COMPLETES the design (BOQ + estimate were removed from the
# flow — the 11-item budget lives in Project Excellence). 'boq' remains a valid
# historical deliverable kind in the DB but is no longer produced or required.
_KIND_ORDER = {"recce": 0, "2d": 1, "3d": 2}
_NEXT_STAGE = {"recce": "2d", "2d": "3d", "3d": "gfc"}
_DELIVERABLE_KINDS = ("recce", "2d", "3d")
# Deliverables that require a SECOND-tier business_admin approval (on top of the
# supervisor's) before the stage advances.
_NEEDS_ADMIN = frozenset({"2d", "3d"})


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


async def _batch_deliverable_by_site(session: AsyncSession, site_ids, *, kind: str) -> dict:
    """Batch design deliverables of one ``kind`` into a ``site_id -> deliverable``
    map in a single query, vs ``_fetch_deliverable_or_none`` per row (N+1) (#91)."""
    ids = [sid for sid in site_ids if sid]
    if not ids:
        return {}
    return {d.site_id: d for d in (await session.execute(
        select(models.DesignDeliverable).where(
            models.DesignDeliverable.site_id.in_(ids),
            models.DesignDeliverable.kind == kind,
        )
    )).scalars()}


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


async def _deliverable_download_url(d: models.DesignDeliverable) -> Optional[str]:
    """Short-lived signed URL for a deliverable's uploaded file.

    Only storage-backed uploads (paths we wrote under 'design/') are signed —
    legacy free-text file_url values are ignored so we don't waste a storage
    round-trip signing something that isn't an object.
    """
    if not d.file_url or not d.file_url.startswith("design/"):
        return None
    try:
        return await storage_signed_url(d.file_url)
    except Exception:
        return None


def _deliverable_to_response(
    d: models.DesignDeliverable, download_url: Optional[str] = None,
) -> DeliverableResponse:
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
        admin_status=getattr(d, "admin_status", None) or "pending",
        admin_comments=getattr(d, "admin_comments", None),
        download_url=download_url,
        updated_at=d.updated_at,
    )


async def _build_design_response(
    session: AsyncSession, site: models.Site,
) -> DesignReviewResponse:
    review = await _fetch_review_or_none(session, site_id=site.id)
    deliverables = await _fetch_deliverables(session, site_id=site.id)
    submitted_by_name = await fetch_user_name(session, site.submitted_by)
    # Each signed URL is an HTTP round-trip to Supabase Storage; doing them
    # sequentially stacked 4+ round-trips onto every design read/upload and
    # pushed responses past the frontend's timeout. Fan out instead.
    download_urls = await asyncio.gather(
        *(_deliverable_download_url(d) for d in deliverables)
    )
    deliverable_responses = [
        _deliverable_to_response(d, download_url=url)
        for d, url in zip(deliverables, download_urls, strict=False)
    ]
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
        deliverables=deliverable_responses,
    )


def _assert_design_unlocked(site: models.Site) -> None:
    """The design module opens after DDR is positive and finance admin approves."""
    if (site.legal_dd_status or "pending") != "positive":
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Design is gated on a positive DDR. Site legal_dd_status is "
                f"'{site.legal_dd_status}', not 'positive'."
            ),
        )
    if (site.finance_status or "pending") != "approved":
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Design is gated on Finance admin approval.",
        )


# ── Queue ─────────────────────────────────────────────────────────────────────

async def svc_design_queue(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    restrict_to_site_ids: Optional[list[str]] = None,
    limit: int = 500,
    offset: int = 0,
) -> DesignQueueResponse:
    """Finance-approved sites that are still active in design (design_status != approved).

    `restrict_to_site_ids` is the additive filter the router passes for an
    executive caller (so they only see sites delegated to them). None = the
    supervisor-wide view.

    Paginated (``limit``/``offset``) so the queue and its batched per-site
    lookups are bounded by page size (#230); exec scoping is applied before the
    page window. ``total`` is the page row count.
    """
    stmt = (
        select(models.Site)
        .where(
            models.Site.tenant_id == tenant_id,
            models.Site.legal_dd_status == "positive",
            models.Site.finance_status == "approved",
            or_(models.Site.design_status.is_(None), models.Site.design_status != "approved"),
        )
        .order_by(models.Site.updated_at.asc(), models.Site.id)  # id = stable-paging tie-breaker
    )
    if restrict_to_site_ids is not None:
        if not restrict_to_site_ids:
            return DesignQueueResponse(items=[], total=0)
        stmt = stmt.where(models.Site.id.in_(restrict_to_site_ids))

    total = await count_rows(session, stmt)
    sites = (await session.execute(stmt.limit(limit).offset(offset))).scalars().all()

    # Batch the per-site lookups: 3 queries total instead of 3 per site
    # (each N+1 round trip costs real latency through pgBouncer/NullPool).
    site_ids = [site.id for site in sites]
    reviews: dict = {}
    delegates: dict = {}
    names: dict = {}
    if site_ids:
        reviews = {r.site_id: r for r in (await session.execute(
            select(models.DesignReview).where(models.DesignReview.site_id.in_(site_ids))
        )).scalars()}
        delegate_rows = (await session.execute(
            select(
                models.SiteDelegation.site_id,
                models.SiteDelegation.delegate_user_id,
                models.User.name,
                models.User.email,
            )
            .join(models.User, models.User.id == models.SiteDelegation.delegate_user_id)
            .where(
                models.SiteDelegation.site_id.in_(site_ids),
                models.SiteDelegation.module == "design",
                models.SiteDelegation.revoked_at.is_(None),
            )
            .order_by(models.SiteDelegation.granted_at.desc())
        )).all()
        for sid, uid, uname, uemail in delegate_rows:
            delegates.setdefault(sid, (uid, uname, uemail))
        submitter_ids = {site.submitted_by for site in sites if site.submitted_by}
        if submitter_ids:
            names = dict((await session.execute(
                select(models.User.id, models.User.name).where(models.User.id.in_(submitter_ids))
            )).all())

    items: list[DesignQueueItem] = []
    for site in sites:
        review = reviews.get(site.id)
        delegate = delegates.get(site.id)
        submitted_by_name = names.get(site.submitted_by, "")
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
    return DesignQueueResponse(items=items, total=total)


async def svc_get_design_review(
    session: AsyncSession, *, site_id: str | UUID, tenant_id: str | UUID,
) -> DesignReviewResponse:
    site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
    _assert_design_unlocked(site)
    return await _build_design_response(session, site)


async def svc_design_history(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    status_filter: str = "all",
    restrict_to_site_ids: Optional[list[str]] = None,
    limit: int = 500,
    offset: int = 0,
) -> DesignHistoryResponse:
    """Read-only Design history for sites that entered or reached Design.

    Executives pass `restrict_to_site_ids` (their design-delegated sites); a
    supervisor passes None and sees the whole tenant's design history.

    Bounded by a safety ceiling (``limit``/``offset``, #230) so the response
    can't grow unbounded with tenant lifetime; ``total`` is the true filtered
    count (not the page size), so KPI tiles stay accurate past the ceiling.
    """
    if restrict_to_site_ids is not None and not restrict_to_site_ids:
        return DesignHistoryResponse(items=[], total=0)
    stmt = (
        select(models.Site, models.DesignReview)
        .outerjoin(models.DesignReview, models.DesignReview.site_id == models.Site.id)
        .where(
            models.Site.tenant_id == tenant_id,
            or_(
                models.DesignReview.site_id.is_not(None),
                models.Site.design_status.in_([
                    "allocated", "in_progress", "gfc_pending", "approved", "rejected",
                ]),
            ),
        )
    )

    if status_filter == "active":
        stmt = stmt.where(
            models.Site.design_status.in_(["pending", "allocated", "in_progress", "gfc_pending"])
        )
    elif status_filter in {"approved", "completed"}:
        stmt = stmt.where(models.Site.design_status == "approved")
    elif status_filter == "rejected":
        stmt = stmt.where(
            or_(
                models.Site.design_status == "rejected",
                models.DesignReview.gfc_status == "rejected",
            )
        )

    if restrict_to_site_ids is not None:
        stmt = stmt.where(models.Site.id.in_(restrict_to_site_ids))

    total = await count_rows(session, stmt)
    rows = (await session.execute(
        stmt.order_by(
            desc(models.DesignReview.updated_at).nulls_last(),
            desc(models.Site.design_approved_at).nulls_last(),
            desc(models.Site.updated_at),
        ).limit(limit).offset(offset)
    )).all()

    # Batch submitter names (1 query) instead of one per row (#91, swept sibling
    # of svc_design_gfc_queue).
    names = await fetch_user_names(session, [site.submitted_by for site, _r in rows])
    items: list[DesignHistoryItem] = []
    for site, review in rows:
        submitted_by_name = names.get(site.submitted_by)
        items.append(DesignHistoryItem(
            site_id=str(site.id),
            site_code=site.ca_code or site.code or "",
            site_name=site.name,
            city=site.city,
            submitted_by_name=submitted_by_name,
            design_status=site.design_status or "pending",
            current_stage=(review.current_stage if review else None),
            gfc_status=(review.gfc_status if review else "pending"),
            legal_dd_status=site.legal_dd_status,
            finance_status=site.finance_status,
            updated_at=(review.updated_at if review else site.updated_at),
        ))
    return DesignHistoryResponse(items=items, total=total)


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
    """Supervisor allocates a finance-approved site to a design executive.

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
        _assert_design_unlocked(site)

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
    # NOTE: no `except Exception → empty list` here. The old swallow had no
    # rollback (leaving the session in a failed-transaction state) and made DB
    # errors indistinguishable from "no delegations" in the UI.
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
    site directly. The sequence is recce→2d→3d→gfc→boq→done. BOQ only reaches
    this helper after business-admin approval.
    """
    next_stage = _NEXT_STAGE[kind]
    review.current_stage = next_stage
    review.approved_by = actor["sub"]

    if next_stage == "gfc":
        # 3D approved → open the GFC gate for the business admin.
        site.design_status = "gfc_pending"
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="design_3d_approved",
            detail="3D approved — site moved to GFC gate (awaiting admin GFC sign-off)",
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
                    f"The 3D design for '{site.name}' ({site.code}) is approved. "
                    f"Open the Design tab to give Good-For-Construction sign-off "
                    f"before the BOQ is uploaded."
                ),
            )
    elif next_stage == "done":
        # BOQ approved → design is now complete.
        site.design_status = "approved"
        site.design_approved_at = datetime.now(timezone.utc)
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="design_boq_approved",
            detail="BOQ approved — design complete",
        )
        supervisors = await recipients_for_design_supervisors(session, tenant_id=tenant_id)
        if supervisors:
            await notify_enqueue(
                session, tenant_id=tenant_id, event="design_complete",
                recipient_ids=supervisors, site_id=site.id,
                channels=("in_app", "email"),
                payload={"site_id": str(site.id), "site_name": site.name},
                subject=f"Design complete: {site.name}",
                body=(
                    f"The BOQ for '{site.name}' ({site.code}) was approved. "
                    f"The design module is complete."
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


async def _after_supervisor_approval(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site: models.Site,
    review: models.DesignReview,
    deliverable: models.DesignDeliverable,
    kind: str,
) -> None:
    """Gate after a supervisor approves a deliverable.

    2D/3D/BOQ need a SECOND-tier business_admin approval before they advance.
    Recce advances immediately; BOQ completion is owned by the business admin.
    """
    if kind in _NEEDS_ADMIN and deliverable.admin_status != "approved":
        if (site.design_status or "pending") in ("pending", "allocated"):
            site.design_status = "in_progress"
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="design_deliverable_awaiting_admin",
            detail=f"kind={kind} approved by supervisor — awaiting business_admin approval",
        )
        admins = await recipients_for_business_admins(session, tenant_id=tenant_id)
        deliverable_label = "BOQ" if kind == "boq" else kind.upper()
        gate_label = (
            "final BOQ approval before Design can complete"
            if kind == "boq"
            else "approval before the design advances"
        )
        if admins:
            await notify_enqueue(
                session, tenant_id=tenant_id, event="design_admin_approval_pending",
                recipient_ids=admins, site_id=site.id,
                channels=("in_app", "email"),
                payload={"site_id": str(site.id), "site_name": site.name, "kind": kind},
                subject=f"{deliverable_label} approval needed: {site.name}",
                body=(
                    f"The {deliverable_label} for '{site.name}' ({site.code}) was approved "
                    f"by the design supervisor and now needs your {gate_label}."
                ),
            )
    else:
        await _advance_stage_after_approval(
            session, tenant_id=tenant_id, actor=actor, site=site, review=review, kind=kind,
        )


async def _resolve_design_review(
    session: AsyncSession, *, tenant_id, actor, site, site_id, kind, is_supervisor,
) -> models.DesignReview:
    """Resolve the DesignReview for a submit: lazily create it on a supervisor
    self-handle, enforce the executive's allocation, and check the active stage.
    Behaviour-preserving extract of svc_submit_deliverable (#240)."""
    review = await _fetch_review_or_none(session, site_id=site.id)
    if review is None:
        if is_supervisor:
            # Supervisor handles the site directly (no executive). Open the design
            # folder lazily on their first upload — no allocation needed.
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
    return review


async def _resolve_submit_deliverable_row(
    session: AsyncSession, *, tenant_id, site, kind, body,
) -> models.DesignDeliverable:
    """Fetch-or-create the deliverable row for a submit, guard its status, and
    apply the uploaded fields. Behaviour-preserving extract of
    svc_submit_deliverable (#240)."""
    deliverable = await _fetch_deliverable_or_none(session, site_id=site.id, kind=kind)
    if deliverable is None:
        deliverable = models.DesignDeliverable(tenant_id=tenant_id, site_id=site.id, kind=kind)
        session.add(deliverable)
    elif deliverable.status not in {"pending", "rejected"}:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"The {kind} deliverable is already {deliverable.status}. "
                "Re-upload is available only after supervisor/admin rejection."
            ),
        )
    if body.file_url is not None:
        deliverable.file_url = body.file_url
    if body.file_name is not None:
        deliverable.file_name = body.file_name
    if kind == "boq" and body.estimated_amount is not None:
        deliverable.estimated_amount = body.estimated_amount
    return deliverable


async def _handle_supervisor_self_upload(
    session: AsyncSession, *, tenant_id, actor, site, review, deliverable, kind, now,
) -> None:
    """Supervisor self-handle: the upload IS the authority — auto-approve and
    advance; the only remaining gate is the admin's GFC. Behaviour-preserving
    extract of svc_submit_deliverable's supervisor branch (#240)."""
    deliverable.status = "approved"
    deliverable.admin_status = "pending"
    deliverable.reviewed_by = actor["sub"]
    deliverable.reviewed_at = now
    deliverable.supervisor_comments = None
    await write_audit_event(
        session, tenant_id=tenant_id, site_id=site.id,
        actor_id=actor["sub"], actor_name=actor.get("name"),
        action="design_deliverable_self_uploaded",
        detail=f"kind={kind} (supervisor handled directly — auto-approved)",
    )
    await _after_supervisor_approval(
        session, tenant_id=tenant_id, actor=actor, site=site, review=review,
        deliverable=deliverable, kind=kind,
    )


async def _handle_executive_upload(
    session: AsyncSession, *, tenant_id, actor, site, review, deliverable, kind,
) -> None:
    """Executive upload: flip to 'submitted' and notify design supervisors for
    review. Behaviour-preserving extract of svc_submit_deliverable's executive
    branch (#240)."""
    deliverable.status = "submitted"
    deliverable.admin_status = "pending"
    deliverable.admin_comments = None
    deliverable.admin_reviewed_by = None
    deliverable.admin_reviewed_at = None
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
        _assert_design_unlocked(site)
        is_supervisor = (actor.get("role") or "").lower() == "supervisor"
        review = await _resolve_design_review(
            session, tenant_id=tenant_id, actor=actor, site=site,
            site_id=site_id, kind=kind, is_supervisor=is_supervisor,
        )
        deliverable = await _resolve_submit_deliverable_row(
            session, tenant_id=tenant_id, site=site, kind=kind, body=body,
        )

        now = datetime.now(timezone.utc)
        deliverable.submitted_by = actor["sub"]
        deliverable.submitted_at = now
        if (site.design_status or "pending") in ("pending", "allocated"):
            site.design_status = "in_progress"

        if is_supervisor:
            await _handle_supervisor_self_upload(
                session, tenant_id=tenant_id, actor=actor, site=site,
                review=review, deliverable=deliverable, kind=kind, now=now,
            )
        else:
            await _handle_executive_upload(
                session, tenant_id=tenant_id, actor=actor, site=site,
                review=review, deliverable=deliverable, kind=kind,
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

    approve → advance current_stage. 2D, 3D, and BOQ wait for business_admin
             approval before advancing; BOQ admin approval completes Design.
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
        _assert_design_unlocked(site)
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
            await _after_supervisor_approval(
                session, tenant_id=tenant_id, actor=actor, site=site, review=review,
                deliverable=deliverable, kind=kind,
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


# ── Business admin: 2D/3D/BOQ approval (second tier) ─────────────────────────

async def svc_design_admin_queue(
    session: AsyncSession, *, tenant_id: str | UUID,
) -> DesignAdminQueueResponse:
    """2D/3D/BOQ deliverables a supervisor approved that now await admin approval,
    grouped by site (each site → its pending deliverables)."""
    rows = (await session.execute(
        select(
            models.DesignDeliverable,
            models.Site.code, models.Site.name, models.Site.city,
        )
        .join(models.Site, models.Site.id == models.DesignDeliverable.site_id)
        .join(models.DesignReview, models.DesignReview.site_id == models.DesignDeliverable.site_id)
        .where(
            models.Site.tenant_id == tenant_id,
            models.DesignDeliverable.kind.in_(tuple(_NEEDS_ADMIN)),
            models.DesignDeliverable.status == "approved",
            models.DesignDeliverable.admin_status == "pending",
            models.DesignReview.current_stage == models.DesignDeliverable.kind,
        )
        .order_by(models.Site.name, models.DesignDeliverable.kind)
    )).all()

    # Sign all deliverable download URLs concurrently (bounded) instead of one
    # sequential storage round trip per row — same fan-out fix as the documents
    # endpoint and _build_design_response (#94, swept sibling).
    _sem = asyncio.Semaphore(8)

    async def _sign(d: models.DesignDeliverable) -> tuple[str, Optional[str]]:
        async with _sem:
            return str(d.id), await _deliverable_download_url(d)

    url_by_id = dict(await asyncio.gather(*[_sign(d) for (d, *_rest) in rows]))

    by_site: dict[str, DesignAdminQueueSite] = {}
    order: list[str] = []
    for (d, code, name, city) in rows:
        sid = str(d.site_id)
        if sid not in by_site:
            by_site[sid] = DesignAdminQueueSite(
                site_id=sid, site_code=code or "", site_name=name, city=city, deliverables=[],
            )
            order.append(sid)
        by_site[sid].deliverables.append(AdminQueueDeliverable(
            id=str(d.id), kind=d.kind, status=d.status, file_name=d.file_name,
            download_url=url_by_id.get(str(d.id)), submitted_at=d.submitted_at,
            estimated_amount=float(d.estimated_amount) if d.estimated_amount is not None else None,
            supervisor_comments=d.supervisor_comments, reviewed_at=d.reviewed_at,
            admin_status=d.admin_status or "pending",
        ))
    return DesignAdminQueueResponse(items=[by_site[s] for s in order], total=len(order))


async def _admin_approve_deliverable(
    session: AsyncSession, *, tenant_id, actor, site, review, deliverable, kind, supervisors,
) -> None:
    """Admin approve path of svc_admin_review_deliverable (behaviour-preserving extract, #240)."""
    deliverable.admin_status = "approved"
    await write_audit_event(
        session, tenant_id=tenant_id, site_id=site.id,
        actor_id=actor["sub"], actor_name=actor.get("name"),
        action="design_admin_approved",
        detail=f"kind={kind} approved by business_admin",
    )
    if review.current_stage == kind:
        await _advance_stage_after_approval(
            session, tenant_id=tenant_id, actor=actor, site=site, review=review, kind=kind,
        )
    if supervisors:
        deliverable_label = "BOQ" if kind == "boq" else kind.upper()
        design_copy = "The design is complete." if kind == "boq" else "The design advances."
        await notify_enqueue(
            session, tenant_id=tenant_id, event="design_admin_approved",
            recipient_ids=supervisors, site_id=site.id, channels=("in_app",),
            payload={"site_id": str(site.id), "site_name": site.name, "kind": kind},
            subject=f"{deliverable_label} approved by admin: {site.name}",
            body=f"The admin approved the {deliverable_label} for '{site.name}'. {design_copy}",
        )


async def _admin_reject_deliverable(
    session: AsyncSession, *, tenant_id, actor, site, deliverable, kind, supervisors,
) -> None:
    """Admin send-back path of svc_admin_review_deliverable (behaviour-preserving extract, #240)."""
    deliverable.status = "rejected"
    deliverable.admin_status = "pending"
    if (site.design_status or "pending") != "approved":
        site.design_status = "in_progress"
    await write_audit_event(
        session, tenant_id=tenant_id, site_id=site.id,
        actor_id=actor["sub"], actor_name=actor.get("name"),
        action="design_admin_rejected",
        detail=f"kind={kind}: {deliverable.admin_comments or ''}",
    )
    if supervisors:
        await notify_enqueue(
            session, tenant_id=tenant_id, event="design_admin_rejected",
            recipient_ids=supervisors, site_id=site.id, channels=("in_app", "email"),
            payload={"site_id": str(site.id), "site_name": site.name,
                     "kind": kind, "comments": deliverable.admin_comments},
            subject=f"{kind.upper()} sent back by admin: {site.name}",
            body=(
                f"The admin sent back the {kind} for '{site.name}'.\n\n"
                f"Comments: {deliverable.admin_comments or '(none)'}"
            ),
        )


async def svc_admin_review_deliverable(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    kind: str,
    body: AdminReviewDeliverableRequest,
) -> DesignReviewResponse:
    """Business admin approves / sends back a supervisor-approved 2D, 3D, or BOQ deliverable.

    approve → admin_status='approved'; if it's still the active stage, advance.
    reject  → deliverable back to 'rejected' for re-upload; comments to the supervisor.
    """
    if (actor.get("role") or "").lower() != "business_admin":
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Only a business admin can approve 2D/3D/BOQ deliverables.",
        )
    if kind not in _NEEDS_ADMIN:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=f"'{kind}' does not require admin approval.",
        )

    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        review = await _fetch_review_or_404(session, site_id=site.id)
        deliverable = await _fetch_deliverable_or_none(session, site_id=site.id, kind=kind)
        if (deliverable is None or deliverable.status != "approved"
                or deliverable.admin_status != "pending"):
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"No supervisor-approved {kind} awaiting admin approval on this site.",
            )
        if review.current_stage != kind:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"The {kind} admin approval is no longer active "
                    f"(current stage: '{review.current_stage}')."
                ),
            )

        now = datetime.now(timezone.utc)
        deliverable.admin_reviewed_by = actor["sub"]
        deliverable.admin_reviewed_at = now
        deliverable.admin_comments = (body.comments or "").strip() or None
        supervisors = await recipients_for_design_supervisors(session, tenant_id=tenant_id)

        if body.decision == "approve":
            await _admin_approve_deliverable(
                session, tenant_id=tenant_id, actor=actor, site=site,
                review=review, deliverable=deliverable, kind=kind, supervisors=supervisors,
            )
        else:
            await _admin_reject_deliverable(
                session, tenant_id=tenant_id, actor=actor, site=site,
                deliverable=deliverable, kind=kind, supervisors=supervisors,
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

    # Batch BOQ deliverables + submitter names (2 queries total) instead of 2
    # per site (#91).
    boq_by_site = await _batch_deliverable_by_site(session, [s.id for s in sites], kind="boq")
    names = await fetch_user_names(session, [s.submitted_by for s in sites])
    items: list[DesignGfcQueueItem] = []
    for site in sites:
        boq = boq_by_site.get(site.id)
        submitted_by_name = names.get(site.submitted_by)
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

    approve → design COMPLETE: design_status='approved', stage='done'. Opens the
              shared post-GFC budget and hands off to Project Excellence (the 11
              budget items now live there, not in a design BOQ).
    reject  → bounce to 3D revision: design_status='in_progress', stage='3d',
              admin comments surfaced to the supervisor (and onto the 3D row).
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
            # GFC approved → design is COMPLETE (BOQ + estimate removed from the
            # flow). Open the shared post-GFC budget so Project Excellence unlocks.
            review.gfc_status = "approved"
            review.current_stage = "done"
            site.design_status = "approved"
            site.design_approved_at = now
            await budget_service.fetch_or_create_budget(
                session, site=site, phase=budget_service.GFC,
            )
            await write_audit_event(
                session, tenant_id=tenant_id, site_id=site.id,
                actor_id=actor["sub"], actor_name=actor.get("name"),
                action="design_gfc_approved",
                detail="GFC approved — design complete; Project Excellence budget opened",
            )
            if supervisors:
                await notify_enqueue(
                    session, tenant_id=tenant_id, event="design_complete",
                    recipient_ids=supervisors, site_id=site.id,
                    channels=("in_app", "email"),
                    payload={"site_id": str(site.id), "site_name": site.name},
                    subject=f"Design complete (GFC approved): {site.name}",
                    body=(
                        f"'{site.name}' ({site.code}) received GFC approval and the design is "
                        f"now complete. The Project Excellence budget is open for this site."
                    ),
                )
            pe_supervisors = await recipients_for_module_supervisors(
                session, tenant_id=tenant_id, module="project_excellence",
            )
            if pe_supervisors:
                await notify_enqueue(
                    session, tenant_id=tenant_id, event="pe_budget_opened",
                    recipient_ids=pe_supervisors, site_id=site.id,
                    channels=("in_app", "email"),
                    payload={"site_id": str(site.id), "site_name": site.name},
                    subject=f"Project Excellence budget ready: {site.name}",
                    body=(
                        f"GFC was approved for '{site.name}' ({site.code}). Open Project "
                        f"Excellence to allocate and fill the 11-item budget."
                    ),
                )
        else:
            # GFC rejected → bounce back to 3D for revision (BOQ hasn't been
            # submitted yet, so we reset the 3D deliverable, not the BOQ).
            review.gfc_status = "rejected"
            review.current_stage = "3d"
            site.design_status = "in_progress"
            deliverable_3d = await _fetch_deliverable_or_none(session, site_id=site.id, kind="3d")
            if deliverable_3d is not None:
                deliverable_3d.status = "rejected"
                deliverable_3d.admin_status = "pending"
                deliverable_3d.supervisor_comments = f"GFC rejected by admin: {review.gfc_comments or ''}"
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
                        f"The GFC for '{site.name}' ({site.code}) was sent back by the admin. "
                        f"The 3D design needs revision.\n\n"
                        f"Comments: {review.gfc_comments or '(none)'}"
                    ),
                )

    return await _build_design_response(session, site)
