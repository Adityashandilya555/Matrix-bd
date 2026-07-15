"""Launch Approval service — the post-NSO *validation loop*.

Flow (see app/domain/schemas/launch.py for the long-form contract):

  pending_admin_review → under_exec_review → under_supervisor_review
  → pending_admin_final → ready_to_launch → launched

Roles:
  - business_admin : reviews full details + every department status; edits ONLY
                     rent terms; "Send for review" (1st touch) and "Confirm"
                     (final touch, which COMMITS staging into site_details+sites).
  - executive      : the site creator — read-only; Approve / Reject + comment.
                     The verdict is recorded and flows forward (never bounces).
  - supervisor     : edits rent terms; Approve / Reject + comment.

Until the final Confirm, every edit lives only on launch_approvals (the staging
row) + launch_review_events. The canonical site_details / sites rent columns are
untouched.

Called from:
  - nso_service.svc_final_approval  (creates the row + writes the draft baseline)
  - launch router endpoints         (advance through the loop)
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Literal, Optional, overload
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.db.session import transaction
from app.domain.schemas.launch import (
    RENT_EDITABLE_FIELDS,
    RENT_FIELD_LABELS,
    DepartmentStatuses,
    LaunchApprovalResponse,
    LaunchCommentRequest,
    LaunchQueueItem,
    LaunchQueueResponse,
    LaunchRentFieldsRequest,
    LaunchReviewEventItem,
    LaunchReviewRequest,
    SiteDetailsSnapshot,
)
from app.services._common import count_rows, fetch_site_or_404, fetch_user_names
from app.services.audit_service import write_audit_event
from app.services.licensing_status import stage_two_canonical_status

logger = logging.getLogger(__name__)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _actor_uuid(actor: dict) -> UUID:
    """Coerce the JWT ``sub`` claim into a UUID, or raise a clean 401 (#145)."""
    try:
        return UUID(actor["sub"])
    except (KeyError, ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=http_status.HTTP_401_UNAUTHORIZED,
            detail="Invalid actor identity in token.",
        ) from exc


def _safe_actor_uuid(actor: Optional[dict]) -> Optional[UUID]:
    """Like ``_actor_uuid`` but returns None instead of raising (event logging)."""
    try:
        return UUID(actor["sub"])  # type: ignore[index]
    except (KeyError, ValueError, TypeError):
        return None


def _num(v) -> Optional[float]:
    return float(v) if v is not None else None


def _norm(v):
    """Normalise a value for change detection (Decimal/float/date → comparable)."""
    if v is None:
        return None
    if isinstance(v, (int, float, Decimal)):
        try:
            return float(v)
        except (TypeError, ValueError):
            return str(v)
    return str(v)


def _str(v) -> Optional[str]:
    """Stringify for the rent-change timeline — integral floats lose the `.0`
    so the admin's history reads `120000`, not `120000.0` (but `4.5` stays `4.5`)."""
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


# Typed via @overload so callers get the precise return type (#234-adjacent
# typecheck fix): required=True can only return a LaunchApproval (it raises 404
# otherwise), so it is non-Optional; required=False may return None. The runtime
# body is unchanged.
@overload
async def _fetch_approval(
    session: AsyncSession,
    *,
    site_id: str | UUID,
    tenant_id: str | UUID,
    required: Literal[True] = ...,
) -> models.LaunchApproval: ...
@overload
async def _fetch_approval(
    session: AsyncSession,
    *,
    site_id: str | UUID,
    tenant_id: str | UUID,
    required: Literal[False],
) -> Optional[models.LaunchApproval]: ...
async def _fetch_approval(
    session: AsyncSession,
    *,
    site_id: str | UUID,
    tenant_id: str | UUID,
    required: bool = True,
) -> Optional[models.LaunchApproval]:
    row = (await session.execute(
        select(models.LaunchApproval).where(
            models.LaunchApproval.site_id == site_id,
            models.LaunchApproval.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if row is None and required:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Launch approval record not found for this site.",
        )
    return row


async def _record_event(
    session: AsyncSession,
    *,
    row: models.LaunchApproval,
    site: models.Site,
    actor: Optional[dict],
    stage: str,
    action: str,
    comment: Optional[str] = None,
    changes: Optional[list[dict]] = None,
) -> None:
    """Append one row to the launch_review_events timeline."""
    session.add(models.LaunchReviewEvent(
        launch_approval_id=row.id,
        site_id=site.id,
        tenant_id=row.tenant_id,
        actor_id=_safe_actor_uuid(actor),
        actor_name=(actor or {}).get("name"),
        actor_role=(actor or {}).get("role"),
        stage=stage,
        action=action,
        comment=comment,
        changes=changes or None,
    ))
    await session.flush()


def _apply_rent_edits(row: models.LaunchApproval, body: LaunchRentFieldsRequest) -> list[dict]:
    """Apply ONLY the rent-editable fields, returning a field-level diff list.

    Anything outside RENT_EDITABLE_FIELDS in the payload is ignored — the rest of
    the record is read-only by contract, enforced here (defence in depth) as well
    as at the router.
    """
    data = body.model_dump(exclude_unset=True)
    changes: list[dict] = []
    for field in RENT_EDITABLE_FIELDS:
        if field not in data:
            continue
        new_val = data[field]
        old_val = getattr(row, field)
        if _norm(old_val) == _norm(new_val):
            continue
        changes.append({
            "field": field,
            "label": RENT_FIELD_LABELS.get(field, field),
            "from": _str(old_val),
            "to": _str(new_val),
        })
        setattr(row, field, new_val)
    return changes


# ── Response builder ─────────────────────────────────────────────────────────────

async def _build_response(
    session: AsyncSession,
    *,
    row: models.LaunchApproval,
    site: models.Site,
) -> LaunchApprovalResponse:
    detail = (await session.execute(
        select(models.SiteDetail).where(models.SiteDetail.site_id == site.id)
    )).scalar_one_or_none()
    nso = (await session.execute(
        select(models.NsoReview).where(models.NsoReview.site_id == site.id)
    )).scalar_one_or_none()
    events = (await session.execute(
        select(models.LaunchReviewEvent)
        .where(models.LaunchReviewEvent.launch_approval_id == row.id)
        .order_by(models.LaunchReviewEvent.created_at)
    )).scalars().all()
    # License statuses must come from canonical Legal Licensing.
    licensing = (await session.execute(
        select(models.SiteLicensing).where(models.SiteLicensing.site_id == site.id)
    )).scalar_one_or_none()
    license_status = stage_two_canonical_status(licensing)

    # Batch actor-name lookups.
    names_map = await fetch_user_names(session, [
        row.admin_sent_for_review_by,
        row.exec_reviewed_by,
        row.supervisor_reviewed_by,
        row.admin_confirmed_by,
        row.launched_by,
    ])

    def _name(uid: Optional[UUID]) -> Optional[str]:
        return names_map.get(uid) if uid else None

    details = SiteDetailsSnapshot(
        name=site.name,
        city=site.city,
        model=site.model,
        google_pin=site.google_maps_pin,
        google_maps_url=site.google_maps_url,
        visit_date=site.visit_date,
        score=_num(detail.score) if detail else None,
        estimated_monthly_sales=_num(detail.estimated_monthly_sales) if detail else None,
        nearest_starbucks=detail.nearest_starbucks_m if detail else None,
        nearest_twc=detail.nearest_twc_m if detail else None,
        carpet_area_sqft=_num(detail.carpet_area_sqft) if detail else None,
        cam_charges=_num(detail.cam_charges) if detail else None,
        capex=_num(detail.capex) if detail else None,
        security_deposit=_num(detail.security_deposit) if detail else None,
        brokerage=_num(detail.brokerage) if detail else None,
    )

    departments = DepartmentStatuses(
        legal_dd_status=site.legal_dd_status,
        agreement_status=site.agreement_status,
        licensing_status=site.licensing_status,
        design_status=site.design_status,
        project_status=site.project_status,
        finance_status=site.finance_status,
        kyc_verified=bool(site.kyc_verified),
        ca_code=site.ca_code,
        nso_status=nso.nso_status if nso else None,
        # Licensing statuses come from canonical Legal Licensing.
        fssai_status=license_status["fssai_status"],
        health_trade_status=license_status["health_trade_status"],
        shops_estab_status=license_status["shops_estab_status"],
        fire_noc_status=license_status["fire_noc_status"],
        storage_license_status=license_status["storage_license_status"],
        launch_date=nso.launch_date if nso else None,
        nso_final_approved_at=nso.final_approved_at if nso else None,
    )

    event_items = [
        LaunchReviewEventItem(
            id=str(e.id),
            actor_name=e.actor_name,
            actor_role=e.actor_role,
            stage=e.stage,
            action=e.action,
            comment=e.comment,
            changes=e.changes,
            created_at=e.created_at,
        )
        for e in events
    ]

    return LaunchApprovalResponse(
        site_id=str(site.id),
        site_code=site.code,
        site_name=site.name,
        city=site.city,
        tenant_id=str(row.tenant_id),
        status=row.status,
        # Editable rent staging
        rent_type=row.rent_type,
        expected_rent=_num(row.expected_rent),
        fixed_rent_amt=_num(row.fixed_rent_amt),
        rev_share_pct=_num(row.rev_share_pct),
        escalation_pct=_num(row.escalation_pct),
        escalation_date=row.escalation_date,
        expected_escalation_years=row.expected_escalation_years,
        rent_free_days=row.rent_free_days,
        lock_in_months=row.lock_in_months,
        tenure_months=row.tenure_months,
        notes=row.notes,
        details=details,
        departments=departments,
        financial_closure_status=site.financial_closure_status or "pending",
        # Stage verdicts / comments
        admin_review_comment=row.admin_review_comment,
        admin_sent_for_review_at=row.admin_sent_for_review_at,
        admin_sent_for_review_by_name=_name(row.admin_sent_for_review_by),
        exec_verdict=row.exec_verdict,
        exec_comment=row.exec_comment,
        exec_reviewed_at=row.exec_reviewed_at,
        exec_reviewed_by_name=_name(row.exec_reviewed_by),
        supervisor_verdict=row.supervisor_verdict,
        supervisor_comment=row.supervisor_comment,
        supervisor_reviewed_at=row.supervisor_reviewed_at,
        supervisor_reviewed_by_name=_name(row.supervisor_reviewed_by),
        admin_final_comment=row.admin_final_comment,
        admin_confirmed_at=row.admin_confirmed_at,
        admin_confirmed_by_name=_name(row.admin_confirmed_by),
        committed_at=row.committed_at,
        launched_at=row.launched_at,
        launched_by_name=_name(row.launched_by),
        events=event_items,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


# ── Create (called by NSO service on final approval) ──────────────────────────

async def svc_create_launch_approval(
    session: AsyncSession,
    *,
    site: models.Site,
    tenant_id: str | UUID,
) -> models.LaunchApproval:
    """Create a launch_approvals row pre-populated from site + site_details and
    record the draft `baseline` rent snapshot. Idempotent — returns the existing
    row on a race / repeat call.
    """
    existing = await _fetch_approval(session, site_id=site.id, tenant_id=tenant_id, required=False)
    if existing:
        return existing

    detail = (await session.execute(
        select(models.SiteDetail).where(models.SiteDetail.site_id == site.id)
    )).scalar_one_or_none()

    row = models.LaunchApproval(
        site_id=site.id,
        tenant_id=site.tenant_id,
        status="pending_admin_review",
        rent_type=site.rent_type,
        expected_rent=_num(site.expected_rent),
        escalation_pct=_num(site.expected_escalation_pct),
        expected_escalation_years=site.expected_escalation_years,
        rev_share_pct=_num(site.expected_revshare_pct),
    )
    if detail:
        row.fixed_rent_amt = _num(detail.fixed_rent_amt)
        row.rev_share_pct = row.rev_share_pct or _num(detail.rev_share_pct)
        row.escalation_pct = row.escalation_pct or _num(detail.escalation_pct)
        row.escalation_date = detail.escalation_date
        row.cam_charges = _num(detail.cam_charges)
        row.security_deposit = _num(detail.security_deposit)
        row.brokerage = _num(detail.brokerage)
        row.lock_in_months = detail.lock_in_months
        row.tenure_months = detail.tenure_months
        row.rent_free_days = detail.rent_free_days
        row.carpet_area_sqft = _num(detail.carpet_area_sqft)
        row.estimated_monthly_sales = _num(detail.estimated_monthly_sales)
        row.capex = _num(detail.capex)
        row.score = _num(detail.score)

    # SAVEPOINT so a duplicate-key failure on the launch_approvals row rolls back
    # only this savepoint and never poisons the caller's NSO transaction.
    try:
        async with session.begin_nested():
            session.add(row)
            await session.flush()  # row.id now available
            baseline = [
                {"field": f, "label": RENT_FIELD_LABELS.get(f, f), "from": None, "to": _str(getattr(row, f))}
                for f in RENT_EDITABLE_FIELDS
                if getattr(row, f) is not None
            ]
            session.add(models.LaunchReviewEvent(
                launch_approval_id=row.id, site_id=site.id, tenant_id=row.tenant_id,
                actor_role="system", stage="system", action="baseline",
                comment="Draft rent terms captured at NSO final approval.",
                changes=baseline or None,
            ))
            await session.flush()
    except IntegrityError:
        logger.warning("launch_approval insert lost a race for site %s — returning existing row", site.id)
        existing_row = await _fetch_approval(session, site_id=site.id, tenant_id=tenant_id, required=True)
        # required=True raises 404 on a miss, so this is never None — narrow the
        # Optional for the type checker (TYP-005) without changing behaviour.
        assert existing_row is not None
        return existing_row
    return row


# ── Queue / detail fetchers ─────────────────────────────────────────────────────

async def svc_get_launch_queue(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    status_filter: Optional[str] = None,
    limit: int = 500,
    offset: int = 0,
) -> LaunchQueueResponse:
    """Return one page of the launch-approval queue, newest-created first.

    Paginated (``limit``/``offset``) so the queue can't grow unbounded with
    tenant lifetime (#230). The queue previously had no ``ORDER BY``; a
    deterministic ``created_at DESC`` order is added so paging is stable.
    ``total`` is the page row count.
    """
    q = select(models.LaunchApproval, models.Site, models.User.name).join(
        models.Site, models.Site.id == models.LaunchApproval.site_id
    ).join(
        models.User, models.User.id == models.Site.submitted_by, isouter=True
    ).where(models.LaunchApproval.tenant_id == tenant_id)

    if status_filter:
        statuses = [s.strip() for s in status_filter.split(",")]
        q = q.where(models.LaunchApproval.status.in_(statuses))

    total = await count_rows(session, q)
    q = q.order_by(models.LaunchApproval.created_at.desc(), models.LaunchApproval.id).limit(limit).offset(offset)
    # LaunchApproval.id = deterministic tie-breaker for stable offset paging
    rows = (await session.execute(q)).all()
    items = [
        LaunchQueueItem(
            site_id=str(site.id),
            site_code=site.code,
            site_name=site.name,
            city=site.city,
            status=approval.status,
            submitted_by=str(site.submitted_by) if site.submitted_by else None,
            created_by_name=creator_name,
            exec_verdict=approval.exec_verdict,
            supervisor_verdict=approval.supervisor_verdict,
            updated_at=approval.updated_at,
            admin_sent_for_review_at=approval.admin_sent_for_review_at,
            exec_reviewed_at=approval.exec_reviewed_at,
            supervisor_reviewed_at=approval.supervisor_reviewed_at,
            committed_at=approval.committed_at,
            launched_at=approval.launched_at,
        )
        for approval, site, creator_name in rows
    ]
    return LaunchQueueResponse(items=items, total=total)


async def svc_get_approval(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    site_id: str | UUID,
) -> LaunchApprovalResponse:
    """Return the current launch-approval record for a site."""
    site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
    row = await _fetch_approval(session, site_id=site.id, tenant_id=tenant_id)
    return await _build_response(session, row=row, site=site)


# ── Rent edits (admin first/final touch, supervisor on review) ───────────────────

# Which roles may edit at which status. Executive is review-only everywhere.
_EDIT_ALLOWED: dict[str, set[str]] = {
    "pending_admin_review": {"business_admin"},
    "pending_admin_final": {"business_admin"},
    "under_supervisor_review": {"supervisor"},
}


async def svc_save_rent_fields(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: LaunchRentFieldsRequest,
) -> LaunchApprovalResponse:
    """Save staged rent-term edits, enforcing which role may edit at the current status."""
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        row = await _fetch_approval(session, site_id=site.id, tenant_id=tenant_id)

        allowed = _EDIT_ALLOWED.get(row.status, set())
        if actor.get("role") not in allowed:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Rent terms are not editable by '{actor.get('role')}' at status '{row.status}'.",
            )

        changes = _apply_rent_edits(row, body)
        if not changes:
            return await _build_response(session, row=row, site=site)

        stage = "supervisor_review" if row.status == "under_supervisor_review" else "admin_review"
        await _record_event(
            session, row=row, site=site, actor=actor,
            stage=stage, action="edited", changes=changes,
        )
        # Mirror each rent change into the global audit feed (field-level diff).
        for ch in changes:
            await write_audit_event(
                session, tenant_id=tenant_id, site_id=site.id,
                actor_id=actor.get("sub"), actor_name=actor.get("name"),
                action="launch_rent_edited",
                field_name=ch["field"], from_value=ch["from"], to_value=ch["to"],
            )
        return await _build_response(session, row=row, site=site)


# ── Stage transitions ────────────────────────────────────────────────────────────

async def svc_admin_send_for_review(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: LaunchCommentRequest,
) -> LaunchApprovalResponse:
    """Admin 1st touch → send to the creating executive."""
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        row = await _fetch_approval(session, site_id=site.id, tenant_id=tenant_id)
        if row.status != "pending_admin_review":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Cannot send for review from status '{row.status}'.",
            )
        row.status = "under_exec_review"
        row.admin_review_comment = (body.comment or "").strip() or None
        row.admin_sent_for_review_at = datetime.now(timezone.utc)
        row.admin_sent_for_review_by = _actor_uuid(actor)

        await _record_event(
            session, row=row, site=site, actor=actor,
            stage="admin_review", action="sent_for_review", comment=row.admin_review_comment,
        )
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="launch_sent_for_review",
            from_status="pending_admin_review", to_status="under_exec_review",
            detail=row.admin_review_comment,
        )
        return await _build_response(session, row=row, site=site)


async def svc_exec_review(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: LaunchReviewRequest,
) -> LaunchApprovalResponse:
    """Executive (creator) records a verdict — flows forward to the supervisor."""
    verdict = (body.verdict or "").strip().lower()
    if verdict not in ("approved", "rejected"):
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="verdict must be 'approved' or 'rejected'.")
    comment = (body.comment or "").strip() or None
    if verdict == "rejected" and not comment:
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A comment is required when rejecting.")

    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        row = await _fetch_approval(session, site_id=site.id, tenant_id=tenant_id)
        if row.status != "under_exec_review":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Cannot record an executive verdict from status '{row.status}'.",
            )
        # Only the executive who created (or is assigned to) the site may review it.
        actor_sub = actor.get("sub")
        if actor_sub not in (str(site.submitted_by), str(site.assigned_to or "")):
            raise HTTPException(
                status_code=http_status.HTTP_403_FORBIDDEN,
                detail="Only the executive who created this site can review it.",
            )
        row.status = "under_supervisor_review"
        row.exec_verdict = verdict
        row.exec_comment = comment
        row.exec_reviewed_at = datetime.now(timezone.utc)
        row.exec_reviewed_by = _actor_uuid(actor)

        await _record_event(
            session, row=row, site=site, actor=actor,
            stage="exec_review", action=verdict, comment=comment,
        )
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action=f"launch_exec_{verdict}",
            from_status="under_exec_review", to_status="under_supervisor_review",
            detail=comment,
        )
        return await _build_response(session, row=row, site=site)


async def svc_supervisor_review(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: LaunchReviewRequest,
) -> LaunchApprovalResponse:
    """Supervisor records a verdict — flows forward to the admin's final touch."""
    verdict = (body.verdict or "").strip().lower()
    if verdict not in ("approved", "rejected"):
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="verdict must be 'approved' or 'rejected'.")
    comment = (body.comment or "").strip() or None
    if verdict == "rejected" and not comment:
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A comment is required when rejecting.")

    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        row = await _fetch_approval(session, site_id=site.id, tenant_id=tenant_id)
        if row.status != "under_supervisor_review":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Cannot record a supervisor verdict from status '{row.status}'.",
            )
        row.status = "pending_admin_final"
        row.supervisor_verdict = verdict
        row.supervisor_comment = comment
        row.supervisor_reviewed_at = datetime.now(timezone.utc)
        row.supervisor_reviewed_by = _actor_uuid(actor)

        await _record_event(
            session, row=row, site=site, actor=actor,
            stage="supervisor_review", action=verdict, comment=comment,
        )
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action=f"launch_supervisor_{verdict}",
            from_status="under_supervisor_review", to_status="pending_admin_final",
            detail=comment,
        )
        return await _build_response(session, row=row, site=site)


def _commit_rent_to_canonical(site: models.Site, detail: models.SiteDetail, row: models.LaunchApproval) -> None:
    """Write the agreed staging rent terms into the canonical sites + site_details
    columns the rest of the app reads (see _common.site_to_response)."""
    now = datetime.now(timezone.utc)
    # sites — pipeline-stage rent mirror
    site.rent_type = row.rent_type
    site.expected_rent = row.expected_rent
    site.expected_escalation_pct = row.escalation_pct
    site.expected_escalation_years = row.expected_escalation_years
    site.expected_revshare_pct = row.rev_share_pct
    site.rent_set_at = now
    # site_details — detailed rent terms
    detail.rent_type = row.rent_type
    detail.fixed_rent_amt = row.fixed_rent_amt if row.fixed_rent_amt is not None else row.expected_rent
    detail.escalation_pct = row.escalation_pct
    detail.escalation_date = row.escalation_date
    detail.rev_share_pct = row.rev_share_pct
    detail.rent_free_days = row.rent_free_days
    detail.lock_in_months = row.lock_in_months
    detail.tenure_months = row.tenure_months


async def svc_admin_final_confirm(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: LaunchCommentRequest,
) -> LaunchApprovalResponse:
    """Admin final touch → COMMIT staging into the DB, unlock Launch."""
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        row = await _fetch_approval(session, site_id=site.id, tenant_id=tenant_id)
        if row.status != "pending_admin_final":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Cannot do the final confirm from status '{row.status}'. Expected 'pending_admin_final'.",
            )

        # Ensure a site_details row exists to receive the committed terms.
        detail = (await session.execute(
            select(models.SiteDetail).where(models.SiteDetail.site_id == site.id)
        )).scalar_one_or_none()
        if detail is None:
            detail = models.SiteDetail(site_id=site.id, tenant_id=site.tenant_id)
            session.add(detail)
            await session.flush()

        now = datetime.now(timezone.utc)
        _commit_rent_to_canonical(site, detail, row)
        row.status = "ready_to_launch"
        row.admin_final_comment = (body.comment or "").strip() or None
        row.admin_confirmed_at = now
        row.admin_confirmed_by = _actor_uuid(actor)
        row.committed_at = now

        await _record_event(
            session, row=row, site=site, actor=actor,
            stage="admin_final", action="confirmed", comment=row.admin_final_comment,
        )
        await _record_event(
            session, row=row, site=site, actor=actor,
            stage="admin_final", action="committed",
            comment="Final rent terms written to site_details + sites.",
        )
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="launch_admin_final_confirmed",
            from_status="pending_admin_final", to_status="ready_to_launch",
            detail=row.admin_final_comment,
        )
        return await _build_response(session, row=row, site=site)


async def svc_launch(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
) -> LaunchApprovalResponse:
    """Terminal go-live → site.is_launched = True."""
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        row = await _fetch_approval(session, site_id=site.id, tenant_id=tenant_id)
        if row.status != "ready_to_launch":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Cannot launch from status '{row.status}'. Requires the admin's final confirm first.",
            )
        now = datetime.now(timezone.utc)
        row.status = "launched"
        row.launched_at = now
        row.launched_by = _actor_uuid(actor)
        site.is_launched = True
        site.launched_at = now

        await _record_event(
            session, row=row, site=site, actor=actor,
            stage="admin_final", action="launched",
        )
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="site_launched",
            from_status="ready_to_launch", to_status="launched",
            detail="Site launched. is_launched flag set across all modules.",
        )
        return await _build_response(session, row=row, site=site)
