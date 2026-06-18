"""Cross-module change request service.

BD opens a request against (site, target_table, field_name) to flip a legal
field value (e.g. flip 'no' → 'yes' on dd.property_tax). Legal supervisor
approves (applying the change to the underlying table immediately) or rejects.

Approved changes overwrite the field value in-place. The original
current_value snapshot stays on the request row so the audit trail is honest
even if Legal flipped the value some other way in between.
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
from app.domain.schemas.legal_change_request import (
    ChangeRequestListResponse,
    ChangeRequestResponse,
    CreateChangeRequestRequest,
    ReviewChangeRequestRequest,
)
from app.domain.state_machine import SiteStatus, assert_transition
from app.services._common import assert_executive_owns_site, fetch_site_or_404, fetch_user_name
from app.services.audit_service import write_audit_event
from app.services.notification_service import (
    enqueue as notify_enqueue,
    recipients_for_legal_supervisors,
    recipients_for_site_owner,
)


# ── Field whitelists ─────────────────────────────────────────────────────────
# Only certain columns are mutable through a change request. Anything else gets
# a 422 — protects against e.g. flipping `final_verdict` directly via this path.

_CORE_DD_FIELDS = {
    "title_doc", "sanctioned_plan", "oc_cc", "commercial_use",
    "property_tax", "electricity", "fire_noc",
}
# other_1/other_2 are optional free-form slots. Schema NOT NULL DEFAULT 'pending'
# so the values are NEVER NULL in practice; 'pending' is the "not used" signal
# and must NOT block recovery. Only an active 'no' blocks the positive flip.
# NULL stays in the allow-list as a defensive guard against schema loosening.
_OPTIONAL_DD_FIELDS = {"other_1", "other_2"}
_OPTIONAL_DD_NON_BLOCKING = {None, "pending", "yes"}
# Full set used by _allowed_field to gate what fields a change-request may touch.
_DD_FIELDS = _CORE_DD_FIELDS | _OPTIONAL_DD_FIELDS
_LICENSING_FIELDS = {
    "fssai", "health_trade", "shops_estab_reg", "fire_noc", "storage_license",
}
_AGREEMENT_FIELDS = {"signed", "registered", "document_url"}


def _allowed_field(target_table: str, field_name: str) -> bool:
    if target_table == "legal_dd_checklist":
        return field_name in _DD_FIELDS
    if target_table == "site_licensing":
        return field_name in _LICENSING_FIELDS
    if target_table == "site_agreement":
        return field_name in _AGREEMENT_FIELDS
    return False


async def _read_current_value(
    session: AsyncSession, *, site_id: str | UUID, target_table: str, field_name: str,
) -> Optional[str]:
    model_cls = {
        "legal_dd_checklist": models.LegalDdChecklist,
        "site_agreement":     models.SiteAgreement,
        "site_licensing":     models.SiteLicensing,
    }[target_table]
    row = (await session.execute(
        select(model_cls).where(model_cls.site_id == site_id)
    )).scalar_one_or_none()
    if row is None:
        return None
    val = getattr(row, field_name, None)
    if val is None:
        return None
    return str(val)


async def _apply_change(
    session: AsyncSession, *, site_id: str | UUID, target_table: str, field_name: str, new_value: str,
) -> None:
    """Overwrite the underlying field. Booleans are coerced from 'true'/'false'."""
    model_cls = {
        "legal_dd_checklist": models.LegalDdChecklist,
        "site_agreement":     models.SiteAgreement,
        "site_licensing":     models.SiteLicensing,
    }[target_table]
    row = (await session.execute(
        select(model_cls).where(model_cls.site_id == site_id)
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"No {target_table} row exists for this site",
        )

    if target_table == "site_agreement" and field_name in ("signed", "registered"):
        setattr(row, field_name, new_value.lower() == "true")
    else:
        setattr(row, field_name, new_value)


def _to_response(
    cr: models.LegalChangeRequest,
    *,
    site_code: str,
    site_name: str,
    requested_by_name: Optional[str],
    reviewed_by_name: Optional[str],
) -> ChangeRequestResponse:
    return ChangeRequestResponse(
        id=str(cr.id),
        site_id=str(cr.site_id),
        site_code=site_code,
        site_name=site_name,
        target_table=cr.target_table,
        field_name=cr.field_name,
        current_value=cr.current_value,
        requested_value=cr.requested_value,
        justification=cr.justification,
        status=cr.status,
        requested_by=str(cr.requested_by),
        requested_by_name=requested_by_name,
        reviewed_by=str(cr.reviewed_by) if cr.reviewed_by else None,
        reviewed_by_name=reviewed_by_name,
        reviewer_note=cr.reviewer_note,
        created_at=cr.created_at,
        reviewed_at=cr.reviewed_at,
    )


# ── BD opens a change request ────────────────────────────────────────────────

async def svc_create_change_request(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    body: CreateChangeRequestRequest,
) -> ChangeRequestResponse:
    """Open a pending change request on a legal field of an executive's own site."""
    if not _allowed_field(body.target_table, body.field_name):
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Field '{body.field_name}' on '{body.target_table}' is not change-requestable",
        )

    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=body.site_id, tenant_id=tenant_id)
        # #104 — executives may only open change requests (and read back the
        # current legal field value) on their own/assigned sites.
        assert_executive_owns_site(actor, site)

        current = await _read_current_value(
            session, site_id=site.id, target_table=body.target_table, field_name=body.field_name,
        )
        if current is None:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"No {body.target_table} row exists for this site yet",
            )

        cr = models.LegalChangeRequest(
            tenant_id=tenant_id,
            site_id=site.id,
            target_table=body.target_table,
            field_name=body.field_name,
            current_value=current,
            requested_value=body.requested_value,
            justification=body.justification,
            requested_by=actor["sub"],
        )
        session.add(cr)
        await session.flush()

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="change_request_opened",
            field_name=f"{body.target_table}.{body.field_name}",
            from_value=current,
            to_value=body.requested_value,
            detail=body.justification or "",
            entity_id=cr.id,
            entity_type="legal_change_request",
        )

        legal_recipients = await recipients_for_legal_supervisors(session, tenant_id=tenant_id)
        if legal_recipients:
            await notify_enqueue(
                session, tenant_id=tenant_id, event="change_request_opened",
                recipient_ids=legal_recipients, site_id=site.id,
                channels=("in_app",),
                payload={
                    "change_request_id": str(cr.id),
                    "site_name": site.name,
                    "field": f"{body.target_table}.{body.field_name}",
                    "requested_value": body.requested_value,
                },
                subject=f"BD change request: {site.name}",
                body=(
                    f"BD has requested a change to {body.target_table}.{body.field_name} "
                    f"on '{site.name}' ({site.code}). Current: {current} → Requested: "
                    f"{body.requested_value}."
                ),
            )

        requested_by_name = await fetch_user_name(session, actor["sub"])

    return _to_response(
        cr,
        site_code=site.code or "",
        site_name=site.name,
        requested_by_name=requested_by_name,
        reviewed_by_name=None,
    )


# ── Legal supervisor reviews ─────────────────────────────────────────────────

async def _fetch_request_or_404(
    session: AsyncSession, *, request_id: str | UUID, tenant_id: str | UUID,
) -> models.LegalChangeRequest:
    cr = (await session.execute(
        select(models.LegalChangeRequest).where(
            models.LegalChangeRequest.id == request_id,
            models.LegalChangeRequest.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if cr is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Change request not found",
        )
    return cr


async def _maybe_recover_dd_verdict(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    cr: models.LegalChangeRequest,
    site: models.Site,
) -> None:
    """Auto-recover a LEGAL_REJECTED site when an approved CR flips the last
    failing DD item to 'yes'.

    Defensive defaults — every precondition must hold or this is a no-op:
      - The CR targets `legal_dd_checklist`.
      - A DD row exists for this site (it should, given the CR existed).
      - All 9 items now read 'yes'.
      - Prior `final_verdict == 'negative'`.
      - `sites.status == LEGAL_REJECTED`.
    """
    if cr.target_table != "legal_dd_checklist":
        return

    dd = (await session.execute(
        select(models.LegalDdChecklist).where(models.LegalDdChecklist.site_id == cr.site_id)
    )).scalar_one_or_none()
    if dd is None:
        return

    # Core fields must all be 'yes'; optional slots (other_1/other_2) must be
    # in _OPTIONAL_DD_NON_BLOCKING — i.e. None / 'pending' (schema default) /
    # 'yes'. An active 'no' on either blocks recovery. See the docstring on
    # _OPTIONAL_DD_FIELDS above for why 'pending' is non-blocking.
    if not (
        all(getattr(dd, col) == "yes" for col in _CORE_DD_FIELDS)
        and all(getattr(dd, col) in _OPTIONAL_DD_NON_BLOCKING for col in _OPTIONAL_DD_FIELDS)
    ):
        return

    if dd.final_verdict != "negative":
        return

    if site.status != SiteStatus.LEGAL_REJECTED.value:
        # Verdict flips to positive only when paired with the rejected→review
        # transition. If the site isn't in LEGAL_REJECTED there's nothing to
        # recover (and we don't want to silently mutate the verdict outside
        # of the recovery path — legal_service owns positive verdicts).
        return

    # All preconditions met — flip the verdict and revive the site.
    dd.final_verdict = "positive"
    assert_transition(SiteStatus.LEGAL_REJECTED, SiteStatus.LEGAL_REVIEW)
    site.status = SiteStatus.LEGAL_REVIEW.value
    site.legal_dd_status = "positive"
    site.legal_rejected_at = None

    await write_audit_event(
        session, tenant_id=tenant_id, site_id=site.id,
        actor_id=actor["sub"], actor_name=actor["name"],
        action="legal_dd_recovered",
        from_status=SiteStatus.LEGAL_REJECTED.value,
        to_status=SiteStatus.LEGAL_REVIEW.value,
        detail=f"DD verdict recomputed to positive after CR {cr.id}",
        entity_id=cr.id,
        entity_type="legal_change_request",
    )

    # Mirror svc_save_due_diligence rejection-path notifications, in reverse:
    # legal supervisors are looped in (email + in_app); BD owner gets an in_app ack.
    legal_recipients = await recipients_for_legal_supervisors(session, tenant_id=tenant_id)
    if legal_recipients:
        await notify_enqueue(
            session, tenant_id=tenant_id, event="site_recovered_to_legal_review",
            recipient_ids=legal_recipients, site_id=site.id,
            channels=("email", "in_app"),
            payload={
                "site_id": str(site.id),
                "site_name": site.name,
                "change_request_id": str(cr.id),
            },
            subject=f"Site recovered to legal review: {site.name}",
            body=(
                f"'{site.name}' ({site.code}) was previously LEGAL_REJECTED. A BD "
                f"change request flipping the final failing DD item was just approved, "
                f"so the site has been auto-recovered to LEGAL_REVIEW with a positive "
                f"DD verdict."
            ),
        )

    bd_recipients = await recipients_for_site_owner(session, site=site)
    if bd_recipients:
        await notify_enqueue(
            session, tenant_id=tenant_id, event="site_recovered_to_legal_review_ack",
            recipient_ids=bd_recipients, site_id=site.id,
            channels=("in_app",),
            payload={
                "site_id": str(site.id),
                "site_name": site.name,
                "change_request_id": str(cr.id),
            },
            subject=f"Site back in legal review: {site.name}",
            body=(
                f"Your change request on '{site.name}' was approved and the site has "
                f"been moved back into legal review."
            ),
        )


async def svc_approve_change_request(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    request_id: str | UUID,
    body: ReviewChangeRequestRequest,
) -> ChangeRequestResponse:
    """Approve a pending change request, apply the field, and run the DD recovery loop."""
    async with transaction(session):
        cr = await _fetch_request_or_404(session, request_id=request_id, tenant_id=tenant_id)

        if cr.status != "pending":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Change request is already {cr.status}",
            )

        site = await fetch_site_or_404(session, site_id=cr.site_id, tenant_id=tenant_id)

        # Apply the change to the underlying table — overwrite immediately.
        await _apply_change(
            session,
            site_id=cr.site_id,
            target_table=cr.target_table,
            field_name=cr.field_name,
            new_value=cr.requested_value,
        )

        now = datetime.now(timezone.utc)
        cr.status        = "approved"
        cr.reviewed_by   = actor["sub"]
        cr.reviewer_note = body.reviewer_note
        cr.reviewed_at   = now

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=cr.site_id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="change_request_approved",
            field_name=f"{cr.target_table}.{cr.field_name}",
            from_value=cr.current_value,
            to_value=cr.requested_value,
            detail=body.reviewer_note or "",
            entity_id=cr.id,
            entity_type="legal_change_request",
        )

        # ── DD recovery loop ─────────────────────────────────────────────
        # If a CR on a DD item flips the final failing 'no' to 'yes' on a site
        # that was previously LEGAL_REJECTED, recompute the verdict and revive
        # the site back into LEGAL_REVIEW. Strict preconditions short-circuit
        # this whole block in the common case.
        await _maybe_recover_dd_verdict(
            session,
            tenant_id=tenant_id,
            actor=actor,
            cr=cr,
            site=site,
        )

        bd_recipients = await recipients_for_site_owner(session, site=site)
        if bd_recipients:
            await notify_enqueue(
                session, tenant_id=tenant_id, event="change_request_approved",
                recipient_ids=bd_recipients, site_id=cr.site_id,
                channels=("in_app",),
                payload={
                    "change_request_id": str(cr.id),
                    "site_name": site.name,
                    "field": f"{cr.target_table}.{cr.field_name}",
                    "new_value": cr.requested_value,
                },
                subject=f"Legal approved your change: {site.name}",
                body=(
                    f"Legal has approved your change request on '{site.name}'. "
                    f"{cr.target_table}.{cr.field_name} is now '{cr.requested_value}'."
                ),
            )

        requested_by_name = await fetch_user_name(session, cr.requested_by)
        reviewed_by_name  = await fetch_user_name(session, cr.reviewed_by)

    return _to_response(
        cr,
        site_code=site.code or "",
        site_name=site.name,
        requested_by_name=requested_by_name,
        reviewed_by_name=reviewed_by_name,
    )


async def svc_reject_change_request(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    request_id: str | UUID,
    body: ReviewChangeRequestRequest,
) -> ChangeRequestResponse:
    """Reject a pending change request, leaving the underlying legal field unchanged."""
    async with transaction(session):
        cr = await _fetch_request_or_404(session, request_id=request_id, tenant_id=tenant_id)

        if cr.status != "pending":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Change request is already {cr.status}",
            )

        site = await fetch_site_or_404(session, site_id=cr.site_id, tenant_id=tenant_id)

        now = datetime.now(timezone.utc)
        cr.status        = "rejected"
        cr.reviewed_by   = actor["sub"]
        cr.reviewer_note = body.reviewer_note
        cr.reviewed_at   = now

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=cr.site_id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="change_request_rejected",
            field_name=f"{cr.target_table}.{cr.field_name}",
            from_value=cr.current_value,
            to_value=cr.requested_value,
            detail=body.reviewer_note or "",
            entity_id=cr.id,
            entity_type="legal_change_request",
        )

        bd_recipients = await recipients_for_site_owner(session, site=site)
        if bd_recipients:
            await notify_enqueue(
                session, tenant_id=tenant_id, event="change_request_rejected",
                recipient_ids=bd_recipients, site_id=cr.site_id,
                channels=("in_app",),
                payload={
                    "change_request_id": str(cr.id),
                    "site_name": site.name,
                    "field": f"{cr.target_table}.{cr.field_name}",
                    "reviewer_note": body.reviewer_note,
                },
                subject=f"Legal rejected your change: {site.name}",
                body=(
                    f"Legal has rejected your change request on '{site.name}'. "
                    f"Reason: {body.reviewer_note or '(no reason given)'}"
                ),
            )

        requested_by_name = await fetch_user_name(session, cr.requested_by)
        reviewed_by_name  = await fetch_user_name(session, cr.reviewed_by)

    return _to_response(
        cr,
        site_code=site.code or "",
        site_name=site.name,
        requested_by_name=requested_by_name,
        reviewed_by_name=reviewed_by_name,
    )


# ── Listings ─────────────────────────────────────────────────────────────────

async def _list_with_status(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    status_filter: Optional[str] = None,
    site_id: Optional[str | UUID] = None,
    requested_by: Optional[str | UUID] = None,
    limit: int = 50,
    offset: int = 0,
) -> ChangeRequestListResponse:
    stmt = select(models.LegalChangeRequest).where(
        models.LegalChangeRequest.tenant_id == tenant_id,
    )
    if status_filter:
        stmt = stmt.where(models.LegalChangeRequest.status == status_filter)
    if site_id:
        stmt = stmt.where(models.LegalChangeRequest.site_id == site_id)
    if requested_by:
        stmt = stmt.where(models.LegalChangeRequest.requested_by == requested_by)
    # Bounded so the change-request backlog can't grow into an unbounded scan +
    # multi-MB response as requests accumulate (#95).
    stmt = stmt.order_by(models.LegalChangeRequest.created_at.desc()).limit(limit).offset(offset)

    rows = (await session.execute(stmt)).scalars().all()

    # Batch the per-request lookups: 2 queries total instead of up to 3 per
    # change request (N+1 round trips through pgBouncer/NullPool).
    sites_by_id: dict = {}
    names: dict = {}
    if rows:
        site_ids = {cr.site_id for cr in rows if cr.site_id}
        if site_ids:
            sites_by_id = {s.id: s for s in (await session.execute(
                select(models.Site).where(models.Site.id.in_(site_ids))
            )).scalars()}
        user_ids = {cr.requested_by for cr in rows if cr.requested_by}
        user_ids |= {cr.reviewed_by for cr in rows if cr.reviewed_by}
        if user_ids:
            names = dict((await session.execute(
                select(models.User.id, models.User.name).where(models.User.id.in_(user_ids))
            )).all())

    items: list[ChangeRequestResponse] = []
    for cr in rows:
        site = sites_by_id.get(cr.site_id)
        items.append(_to_response(
            cr,
            site_code=site.code if site else "",
            site_name=site.name if site else "",
            requested_by_name=names.get(cr.requested_by),
            reviewed_by_name=names.get(cr.reviewed_by),
        ))

    return ChangeRequestListResponse(items=items, total=len(items))


async def svc_list_pending_for_legal(
    session: AsyncSession, *, tenant_id: str | UUID, limit: int = 50, offset: int = 0,
) -> ChangeRequestListResponse:
    """List the tenant's pending change requests for the legal review queue."""
    return await _list_with_status(
        session, tenant_id=tenant_id, status_filter="pending", limit=limit, offset=offset,
    )


async def svc_list_for_site(
    session: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID,
) -> ChangeRequestListResponse:
    """List every change request raised against one site, regardless of status."""
    return await _list_with_status(session, tenant_id=tenant_id, site_id=site_id)


async def svc_list_my_requests(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict,
) -> ChangeRequestListResponse:
    """List the change requests raised by the calling actor."""
    return await _list_with_status(session, tenant_id=tenant_id, requested_by=actor["sub"])
