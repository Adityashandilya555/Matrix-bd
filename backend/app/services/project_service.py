"""Project Execution service.

Opens after Design reaches GFC approval (`sites.design_status = 'approved'`).
The module owns execution milestones in `project_reviews`; budget tracking
has moved to the Project Excellence module (202606134).
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.db.session import transaction
from app.domain.schemas.common import OkResponse
from app.domain.schemas.project import (
    AdminConfirmQualityAuditRequest,
    InitializationFinalizeRequest,
    InitializationProposeRequest,
    InitializationRespondRequest,
    MidVisitRequest,
    MilestoneRequest,
    ProjectBudgetLine,
    ProjectHistoryItem,
    ProjectHistoryResponse,
    ProjectQueueItem,
    ProjectQueueResponse,
    ProjectStateResponse,
    ReviewRequest,
)
from app.services import budget_service
from app.services._common import count_rows, fetch_site_or_404, fetch_user_name, fetch_user_names
from app.services.audit_service import write_audit_event
from app.services.delegation_service import svc_is_delegated


def _is_supervisor(actor: dict) -> bool:
    return (actor.get("role") or "").lower() == "supervisor"


def _is_business_admin(actor: dict) -> bool:
    return (actor.get("role") or "").lower() == "business_admin"


def _assert_project_unlocked(site: models.Site) -> None:
    if (site.design_status or "pending") != "approved":
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Project is locked until Design receives final GFC approval.",
        )


async def _active_project_delegate(
    session: AsyncSession, *, site_id: str | UUID,
) -> Optional[tuple[UUID, str, str]]:
    row = (await session.execute(
        select(models.SiteDelegation.delegate_user_id, models.User.name, models.User.email)
        .join(models.User, models.User.id == models.SiteDelegation.delegate_user_id)
        .where(
            models.SiteDelegation.site_id == site_id,
            models.SiteDelegation.module == "project",
            models.SiteDelegation.revoked_at.is_(None),
        )
        .order_by(models.SiteDelegation.granted_at.desc())
        .limit(1)
    )).first()
    return (row[0], row[1], row[2]) if row else None


async def _fetch_review_or_none(
    session: AsyncSession, *, site_id: str | UUID,
) -> Optional[models.ProjectReview]:
    return (await session.execute(
        select(models.ProjectReview).where(models.ProjectReview.site_id == site_id)
    )).scalar_one_or_none()


async def _fetch_review_or_create(
    session: AsyncSession, *, site: models.Site,
) -> models.ProjectReview:
    review = await _fetch_review_or_none(session, site_id=site.id)
    if review is not None:
        return review
    review = models.ProjectReview(
        tenant_id=site.tenant_id,
        site_id=site.id,
        project_status="pending",
        current_stage="execution",
    )
    session.add(review)
    await session.flush()
    return review


async def seed_initialization_from_pe(
    session: AsyncSession, *, site: models.Site, initialization_date,
) -> models.ProjectReview:
    """Seed the Project module's initialization when a PE budget is approved.

    The Project Excellence admin approval is the handover point into the Project
    module: it proposes the initialization date the executive then accepts or
    rejects (svc_respond_initialization). Without this the review was created
    with initialization_status='pending' and the exchange could never start.

    Idempotent and non-destructive: only seeds while still pending, so a
    re-run never clobbers an in-flight proposed/approved/rejected exchange.
    (A freshly-created review carries None in-memory — the 'pending'
    server_default only materializes on a DB read — so None counts as pending.)
    Caller owns the transaction.
    """
    review = await _fetch_review_or_create(session, site=site)
    if review.initialization_status in (None, "pending"):
        review.initialization_date = initialization_date
        review.initialization_status = "proposed"
    return review


async def _queue_item(
    session: AsyncSession, site: models.Site, review: Optional[models.ProjectReview],
    *, prefetched: Optional[dict] = None,
) -> ProjectQueueItem:
    # `prefetched` lets list endpoints batch the delegate/name lookups into two
    # queries total instead of two per site (N+1 through pgBouncer/NullPool).
    if prefetched is None:
        delegate = await _active_project_delegate(session, site_id=site.id)
        submitted_by_name = await fetch_user_name(session, site.submitted_by)
    else:
        delegate = prefetched.get("delegate")
        submitted_by_name = prefetched.get("submitted_by_name")
    return ProjectQueueItem(
        site_id=str(site.id),
        site_code=site.ca_code or site.code or "",
        site_name=site.name,
        city=site.city,
        design_status=site.design_status or "pending",
        project_status=(review.project_status if review else "pending"),
        current_stage=(review.current_stage if review else "execution"),
        quality_audit_status=(review.quality_audit_status if review else "pending"),
        inspection_date=(review.inspection_date if review else None),
        project_completed_at=(review.project_completed_at if review else None),
        allocated_to_name=(delegate[1] if delegate else None),
        submitted_by_name=submitted_by_name,
    )


async def _batch_project_prefetch(
    session: AsyncSession, sites: list[models.Site],
) -> tuple[dict, dict]:
    """Batch the per-site project-delegate + submitter-name lookups into two
    queries total, instead of two per site.

    `_queue_item` otherwise issues `_active_project_delegate` + `fetch_user_name`
    per row — an N+1 that costs a full connection round trip each through the
    pgBouncer/NullPool transaction pooler (#81). Returns
    `(delegates_by_site_id, names_by_user_id)`; pass the slices into
    `_queue_item(..., prefetched=...)`.
    """
    delegates: dict = {}
    names: dict = {}
    site_ids = [s.id for s in sites]
    if not site_ids:
        return delegates, names
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
            models.SiteDelegation.module == "project",
            models.SiteDelegation.revoked_at.is_(None),
        )
        .order_by(models.SiteDelegation.granted_at.desc())
    )).all()
    for sid, uid, uname, uemail in delegate_rows:
        delegates.setdefault(sid, (uid, uname, uemail))
    submitter_ids = {s.submitted_by for s in sites if s.submitted_by}
    if submitter_ids:
        names = dict((await session.execute(
            select(models.User.id, models.User.name).where(models.User.id.in_(submitter_ids))
        )).all())
    return delegates, names


async def _gfc_budget_lines(
    session: AsyncSession, *, site_id: str | UUID, tenant_id: str | UUID,
) -> tuple[Optional[models.SiteBudget], list[ProjectBudgetLine]]:
    """The approved post-GFC budget (read-only) shown inside the Project module."""
    budget = await budget_service.fetch_budget(session, site_id=site_id, phase=budget_service.GFC, tenant_id=tenant_id)
    if budget is None:
        return None, []
    items = await budget_service.budget_items(session, budget_id=budget.id, tenant_id=tenant_id)
    lines = [
        ProjectBudgetLine(
            idx=i.idx,
            label=i.label,
            amount=float(i.amount) if i.amount is not None else None,
        )
        for i in items
    ]
    return budget, lines


async def _build_response(
    session: AsyncSession, site: models.Site, review: models.ProjectReview,
) -> ProjectStateResponse:
    delegate = await _active_project_delegate(session, site_id=site.id)
    budget, budget_lines = await _gfc_budget_lines(session, site_id=site.id, tenant_id=site.tenant_id)
    return ProjectStateResponse(
        site_id=str(site.id),
        site_code=site.ca_code or site.code or "",
        site_name=site.name,
        city=site.city,
        tenant_id=str(site.tenant_id),
        submitted_by_name=await fetch_user_name(session, site.submitted_by),
        site_status=site.status,
        design_status=site.design_status or "pending",
        project_status=review.project_status,
        current_stage=review.current_stage,
        allocated_to=str(review.allocated_to) if review.allocated_to else None,
        allocated_to_name=(delegate[1] if delegate else None),
        initialization_date=review.initialization_date,
        initialization_status=review.initialization_status,
        initialization_comments=review.initialization_comments,
        expected_completion_date=review.expected_completion_date,
        expected_completion_status=review.expected_completion_status,
        expected_completion_comments=review.expected_completion_comments,
        mid_project_visit_date=review.mid_project_visit_date,
        inspection_date=review.inspection_date,
        quality_audit_status=review.quality_audit_status,
        quality_audit_comments=review.quality_audit_comments,
        quality_audit_supervisor_approved_at=review.quality_audit_supervisor_approved_at,
        quality_audit_admin_confirmed_at=review.quality_audit_admin_confirmed_at,
        quality_audit_admin_notes=review.quality_audit_admin_notes,
        final_completion_date=review.final_completion_date,
        project_completed_at=review.project_completed_at,
        nso_status=review.nso_status,
        pushed_to_nso_at=review.pushed_to_nso_at,
        # Read-only post-GFC budget (lives in Project Excellence / site_budgets).
        budget_status=(budget.status if budget else "draft"),
        budget_total=float(budget.budget_total) if budget and budget.budget_total is not None else None,
        budget_items=budget_lines,
        # Area & covers come off the same GFC budget row; without these the
        # Project module showed blank inputs and "—" for every derived metric.
        total_indoor_area_sqft=float(budget.total_indoor_area_sqft) if budget and budget.total_indoor_area_sqft is not None else None,
        total_area_sqft=float(budget.total_area_sqft) if budget and budget.total_area_sqft is not None else None,
        covers=int(budget.covers) if budget and budget.covers is not None else None,
        updated_at=review.updated_at,
    )


async def _assert_can_work_project(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
) -> None:
    if _is_supervisor(actor):
        return
    if (actor.get("role") or "").lower() != "executive":
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Project access denied.")
    allowed = await svc_is_delegated(
        session,
        tenant_id=tenant_id,
        site_id=site_id,
        user_id=actor["sub"],
        module="project",
    )
    if not allowed:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Executive is not allocated to this project site.",
        )


async def svc_project_queue(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    restrict_to_site_ids: Optional[list[str]] = None,
    limit: int = 500,
    offset: int = 0,
) -> ProjectQueueResponse:
    """Return one page of the active Project queue, oldest-updated first.

    Paginated (``limit``/``offset``) so the queue and its per-row enrichment are
    bounded by page size (#230). Executive ``restrict_to_site_ids`` scoping is
    applied before pagination. ``total`` is the page row count.
    """
    async with transaction(session):
        # One joined query for sites+reviews (done-filter pushed into SQL), one
        # batched delegate lookup, one batched name lookup — instead of the old
        # 1 + 3N round trips with INSERT flushes on a GET. Reviews are no
        # longer created here: every write path uses _fetch_review_or_create,
        # and _queue_item already renders sensible defaults for review=None.
        stmt = (
            select(models.Site, models.ProjectReview)
            .outerjoin(models.ProjectReview, models.ProjectReview.site_id == models.Site.id)
            .where(
                models.Site.tenant_id == tenant_id,
                models.Site.design_status == "approved",
                or_(
                    models.ProjectReview.project_status.is_(None),
                    models.ProjectReview.project_status != "done",
                ),
            )
            .order_by(models.Site.updated_at.asc(), models.Site.id)  # id = stable-paging tie-breaker
        )
        if restrict_to_site_ids is not None:
            if not restrict_to_site_ids:
                return ProjectQueueResponse(items=[], total=0)
            stmt = stmt.where(models.Site.id.in_(restrict_to_site_ids))
        total = await count_rows(session, stmt)
        rows = (await session.execute(stmt.limit(limit).offset(offset))).all()

        delegates, names = await _batch_project_prefetch(session, [site for site, _r in rows])

        items: list[ProjectQueueItem] = []
        for site, review in rows:
            items.append(await _queue_item(
                session, site, review,
                prefetched={
                    "delegate": delegates.get(site.id),
                    "submitted_by_name": names.get(site.submitted_by, ""),
                },
            ))
        return ProjectQueueResponse(items=items, total=total)


async def svc_project_history(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    status_filter: str = "all",
    restrict_to_site_ids: Optional[list[str]] = None,
    limit: int = 500,
    offset: int = 0,
) -> ProjectHistoryResponse:
    """Read-only Project history for sites that reached or entered Project.

    Executives pass `restrict_to_site_ids` (their project-delegated sites); a
    supervisor passes None and sees the whole tenant's project history.

    Paginated (``limit``/``offset``, newest first) so the response can't grow
    unbounded with tenant lifetime (#230); exec scoping is applied before the
    page window. ``total`` is the page row count.
    """
    if restrict_to_site_ids is not None and not restrict_to_site_ids:
        return ProjectHistoryResponse(items=[], total=0)
    stmt = (
        select(models.Site, models.ProjectReview)
        .outerjoin(models.ProjectReview, models.ProjectReview.site_id == models.Site.id)
        .where(
            models.Site.tenant_id == tenant_id,
            or_(
                models.ProjectReview.site_id.is_not(None),
                models.Site.design_status == "approved",
            ),
        )
    )

    if status_filter == "active":
        stmt = stmt.where(
            or_(
                models.ProjectReview.project_status.is_(None),
                models.ProjectReview.project_status.in_(["pending", "allocated", "in_progress"]),
            )
        )
    elif status_filter in {"approved", "completed"}:
        stmt = stmt.where(models.ProjectReview.project_status == "done")

    if restrict_to_site_ids is not None:
        stmt = stmt.where(models.Site.id.in_(restrict_to_site_ids))

    total = await count_rows(session, stmt)
    rows = (await session.execute(
        stmt.order_by(
            desc(models.ProjectReview.updated_at).nulls_last(),
            desc(models.Site.updated_at),
            models.Site.id,  # deterministic tie-breaker for stable offset paging
        ).limit(limit).offset(offset)
    )).all()

    # Batch submitter names (1 query) instead of one per row (#91).
    names = await fetch_user_names(session, [site.submitted_by for site, _r in rows])
    items: list[ProjectHistoryItem] = []
    for site, review in rows:
        items.append(ProjectHistoryItem(
            site_id=str(site.id),
            site_code=site.ca_code or site.code or "",
            site_name=site.name,
            city=site.city,
            submitted_by_name=names.get(site.submitted_by),
            design_status=site.design_status or "pending",
            project_status=(review.project_status if review else "pending"),
            current_stage=(review.current_stage if review else "execution"),
            project_completed_at=(review.project_completed_at if review else None),
            updated_at=(review.updated_at if review else site.updated_at),
        ))
    return ProjectHistoryResponse(items=items, total=total)


async def svc_get_project(
    session: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID,
) -> ProjectStateResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        _assert_project_unlocked(site)
        review = await _fetch_review_or_create(session, site=site)
        return await _build_response(session, site, review)


async def svc_get_project_history_detail(
    session: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID,
) -> ProjectStateResponse:
    """Read-only Project history detail.

    Unlike the active Project detail route, this must not lazily create a
    project_reviews row just because someone opened History.
    """
    site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
    review = await _fetch_review_or_none(session, site_id=site.id)
    if review is None:
        if (site.design_status or "pending") != "approved":
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="This site has not entered Project history.",
            )
        review = models.ProjectReview(
            tenant_id=site.tenant_id,
            site_id=site.id,
            project_status="pending",
            current_stage="execution",
            initialization_status="pending",
            expected_completion_status="pending",
            quality_audit_status="pending",
        )
        review.updated_at = site.updated_at
    return await _build_response(session, site, review)


async def svc_list_project_delegations_for_site(
    session: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID,
) -> dict:
    stmt = (
        select(models.SiteDelegation, models.User.email, models.User.name)
        .join(models.User, models.User.id == models.SiteDelegation.delegate_user_id)
        .where(
            models.SiteDelegation.site_id == site_id,
            models.SiteDelegation.tenant_id == tenant_id,
            models.SiteDelegation.module == "project",
            models.SiteDelegation.revoked_at.is_(None),
        )
        .order_by(models.SiteDelegation.granted_at.desc())
    )
    rows = (await session.execute(stmt)).all()
    return {
        "items": [
            {
                "id": str(row.id),
                "site_id": str(row.site_id),
                "module": row.module,
                "delegate_user_id": str(row.delegate_user_id),
                "delegate_email": email,
                "delegate_name": name,
                "granted_by": str(row.granted_by),
                "granted_at": row.granted_at,
                "notes": row.notes,
            }
            for (row, email, name) in rows
        ],
        "total": len(rows),
    }


async def svc_allocate_project(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    delegate_user_id: str | UUID,
    notes: Optional[str] = None,
) -> ProjectStateResponse:
    if not _is_supervisor(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a project supervisor can allocate.")
    if str(delegate_user_id) == str(actor["sub"]):
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail="Cannot allocate to yourself.")

    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        _assert_project_unlocked(site)
        delegate = (await session.execute(
            select(models.User).where(
                models.User.id == delegate_user_id,
                models.User.tenant_id == tenant_id,
                models.User.is_active.is_(True),
            )
        )).scalar_one_or_none()
        if delegate is None or (delegate.role or "").lower() != "executive":
            raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Active executive not found.")
        existing = (await session.execute(
            select(models.SiteDelegation).where(
                models.SiteDelegation.site_id == site.id,
                models.SiteDelegation.module == "project",
                models.SiteDelegation.delegate_user_id == delegate_user_id,
                models.SiteDelegation.revoked_at.is_(None),
            )
        )).scalar_one_or_none()
        if existing is not None:
            raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail="Project allocation already exists.")

        row = models.SiteDelegation(
            tenant_id=tenant_id,
            site_id=site.id,
            module="project",
            delegate_user_id=delegate_user_id,
            granted_by=actor["sub"],
            notes=(notes or "").strip() or None,
        )
        session.add(row)
        review = await _fetch_review_or_create(session, site=site)
        review.allocated_to = delegate.id
        review.project_status = "allocated"
        review.current_stage = "execution"
        site.project_status = "allocated"  # keep the sites mirror in sync (#134)
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="project_allocated",
            detail=f"delegate={delegate.email}",
        )
        return await _build_response(session, site, review)


async def svc_revoke_project_delegation(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    delegate_user_id: str | UUID,
) -> OkResponse:
    if not _is_supervisor(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a project supervisor can revoke.")
    async with transaction(session):
        row = (await session.execute(
            select(models.SiteDelegation).where(
                models.SiteDelegation.tenant_id == tenant_id,
                models.SiteDelegation.site_id == site_id,
                models.SiteDelegation.module == "project",
                models.SiteDelegation.delegate_user_id == delegate_user_id,
                models.SiteDelegation.revoked_at.is_(None),
            )
        )).scalar_one_or_none()
        if row is None:
            return OkResponse(message="No active project allocation to revoke.")
        row.revoked_at = datetime.now(timezone.utc)
        row.revoked_by = actor["sub"]
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=row.site_id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="project_allocation_revoked",
        )
    return OkResponse(message="Project allocation revoked.")


async def svc_submit_milestone(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    field: str,
    body: MilestoneRequest,
) -> ProjectStateResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        await _assert_can_work_project(session, tenant_id=tenant_id, actor=actor, site_id=site.id)
        review = await _fetch_review_or_create(session, site=site)
        if review.project_status not in {"allocated", "in_progress"}:
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Site must be allocated before setting milestones.")
        review.project_status = "in_progress"
        site.project_status = "in_progress"  # keep mirror in sync (#134)
        if field == "expected_completion_date":
            # Only available once the initialization date is finalized.
            if review.initialization_status != "approved":
                raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Initialization date must be confirmed first.")
            review.expected_completion_date = body.value
            review.expected_completion_status = "approved" if _is_supervisor(actor) else "submitted"
        elif field == "final_completion_date":
            if review.quality_audit_status != "approved":
                raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Quality audit must be approved first.")
            review.final_completion_date = body.value
            review.project_status = "done"
            review.current_stage = "done"
            review.project_completed_at = datetime.now(timezone.utc)
            site.project_status = "done"  # keep the sites mirror in sync (#134)
            site.project_completed_at = review.project_completed_at
        else:
            raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail=f"Unsupported milestone field: {field}")
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="project_milestone_submitted",
            detail=f"{field}={body.value}",
        )
        return await _build_response(session, site, review)


async def svc_review_milestone(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    field: str,
    body: ReviewRequest,
) -> ProjectStateResponse:
    if not _is_supervisor(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a project supervisor can review milestones.")
    if field != "expected_completion_date":
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail="This milestone does not need supervisor review.")
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        review = await _fetch_review_or_create(session, site=site)
        status_field = "expected_completion_status"
        comments_field = "expected_completion_comments"
        if getattr(review, status_field) != "submitted":
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Milestone is not awaiting review.")
        setattr(review, status_field, "approved" if body.decision == "approve" else "rejected")
        if body.decision == "reject":
            setattr(review, comments_field, (body.comments or "").strip() or "Rejected by supervisor.")
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="project_milestone_reviewed",
            detail=f"{field} decision={body.decision}",
        )
        return await _build_response(session, site, review)


async def svc_propose_initialization(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: InitializationProposeRequest,
) -> ProjectStateResponse:
    """Supervisor proposes the initialization date from the Project module.

    Recovery path for when the Project-Excellence admin handover never seeded a
    date (status still 'pending') — without it those sites dead-end with no way
    to start the exchange. Only fires while still pending so it can never clobber
    an in-flight proposed/approved/rejected date.
    """
    if not _is_supervisor(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a project supervisor can set the initialization date.")
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        review = await _fetch_review_or_create(session, site=site)
        # A freshly-created review carries None in-memory (the 'pending'
        # server_default only materializes on a DB read), so treat None as pending.
        if review.initialization_status not in (None, "pending"):
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="An initialization date has already been proposed.")
        review.initialization_date = body.value
        review.initialization_status = "proposed"
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="project_initialization_proposed",
            detail=f"date={body.value}",
        )
        return await _build_response(session, site, review)


async def svc_respond_initialization(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: InitializationRespondRequest,
) -> ProjectStateResponse:
    """Executive accepts or rejects the admin-proposed initialization date."""
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        await _assert_can_work_project(session, tenant_id=tenant_id, actor=actor, site_id=site.id)
        review = await _fetch_review_or_create(session, site=site)
        if review.initialization_status != "proposed":
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Initialization date is not awaiting a response.")
        if body.decision == "approve":
            review.initialization_status = "approved"
        else:
            review.initialization_status = "rejected"
            review.initialization_comments = (body.comments or "").strip() or "Rejected by executive."
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="project_initialization_responded",
            detail=f"decision={body.decision}",
        )
        return await _build_response(session, site, review)


async def svc_finalize_initialization(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: InitializationFinalizeRequest,
) -> ProjectStateResponse:
    """Supervisor sets the final initialization date after an executive rejection."""
    if not _is_supervisor(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a project supervisor can finalize the initialization date.")
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        review = await _fetch_review_or_create(session, site=site)
        if review.initialization_status != "rejected":
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Initialization date is not awaiting a supervisor revision.")
        review.initialization_date = body.value
        review.initialization_status = "approved"
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="project_initialization_finalized",
            detail=f"date={body.value}",
        )
        return await _build_response(session, site, review)


async def svc_set_mid_visit(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: MidVisitRequest,
) -> ProjectStateResponse:
    """Supervisor sets the mid-project visit date (after expected completion is approved)."""
    if not _is_supervisor(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a project supervisor can set the mid-project visit date.")
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        review = await _fetch_review_or_create(session, site=site)
        if review.expected_completion_status != "approved":
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Expected completion must be approved first.")
        review.mid_project_visit_date = body.value
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="project_mid_visit_set",
            detail=f"date={body.value}",
        )
        return await _build_response(session, site, review)


async def svc_submit_inspection_date(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: MilestoneRequest,
) -> ProjectStateResponse:
    """Executive records the quality-audit inspection DATE (no document upload),
    then submits it for the supervisor → business_admin two-tier sign-off."""
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        await _assert_can_work_project(session, tenant_id=tenant_id, actor=actor, site_id=site.id)
        review = await _fetch_review_or_create(session, site=site)
        if review.mid_project_visit_date is None:
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Mid-project visit date must be set before the quality audit.")
        review.inspection_date = body.value
        review.quality_audit_status = "submitted"
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="project_quality_audit_date_submitted",
            detail=f"inspection_date={body.value}",
        )
        return await _build_response(session, site, review)


async def svc_supervisor_approve_quality_audit(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: ReviewRequest,
) -> ProjectStateResponse:
    """First tier: the project supervisor approves the inspection date (or rejects)."""
    if not _is_supervisor(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a project supervisor can approve the quality audit.")
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        review = await _fetch_review_or_create(session, site=site)
        if review.quality_audit_status != "submitted":
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Quality audit is not awaiting supervisor approval.")
        if body.decision == "approve":
            review.quality_audit_status = "supervisor_approved"
            review.quality_audit_supervisor_approved_at = datetime.now(timezone.utc)
            review.quality_audit_supervisor_approved_by = actor["sub"]
        else:
            review.quality_audit_status = "rejected"
            review.quality_audit_comments = (body.comments or "").strip() or "Rejected by supervisor."
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="project_quality_audit_supervisor_reviewed",
            detail=f"decision={body.decision}",
        )
        return await _build_response(session, site, review)


async def svc_admin_confirm_quality_audit(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: AdminConfirmQualityAuditRequest,
) -> ProjectStateResponse:
    """Second tier: the business_admin confirms. On confirm the project COMPLETES.
    The site does NOT auto-push to NSO — the supervisor pushes it from the
    Project module's 'NSO Handover' tab (see svc_push_to_nso)."""
    if not _is_business_admin(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a business admin can confirm the quality audit.")
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        review = await _fetch_review_or_create(session, site=site)
        if review.quality_audit_status != "supervisor_approved":
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Quality audit is not awaiting admin confirmation.")
        if body.decision == "approve":
            now = datetime.now(timezone.utc)
            review.quality_audit_status = "approved"
            review.quality_audit_admin_confirmed_at = now
            review.quality_audit_admin_confirmed_by = actor["sub"]
            review.quality_audit_admin_notes = (body.admin_notes or "").strip() or None
            review.project_status = "done"
            review.current_stage = "done"
            review.project_completed_at = now
            site.project_status = "done"  # keep the sites mirror in sync (#134)
            site.project_completed_at = now
        else:
            review.quality_audit_status = "rejected"
            review.quality_audit_comments = (body.comments or "").strip() or "Rejected by business admin."
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="project_quality_audit_admin_confirmed",
            detail=f"decision={body.decision}",
        )
        return await _build_response(session, site, review)


async def svc_nso_queue(
    session: AsyncSession, *, tenant_id: str | UUID,
) -> ProjectQueueResponse:
    """Sites completed in Project and pushed to NSO — the handoff queue the
    (parallel) NSO module consumes."""
    # NOTE: no blanket `except SQLAlchemyError → empty list` here (see
    # svc_budget_admin_queue) — a DB error must surface as a 500, not render
    # as "queue is empty".
    rows = (await session.execute(
        select(models.Site, models.ProjectReview)
        .join(models.ProjectReview, models.ProjectReview.site_id == models.Site.id)
        .where(
            models.Site.tenant_id == tenant_id,
            models.ProjectReview.nso_status == "pushed",
        )
        .order_by(models.ProjectReview.pushed_to_nso_at.desc())
    )).all()
    # Batch the delegate/name lookups (2 queries total) instead of 2 per site (#81).
    delegates, names = await _batch_project_prefetch(session, [site for site, _r in rows])
    items = [
        await _queue_item(session, site, review, prefetched={
            "delegate": delegates.get(site.id),
            "submitted_by_name": names.get(site.submitted_by, ""),
        })
        for (site, review) in rows
    ]
    return ProjectQueueResponse(items=items, total=len(items))


async def svc_nso_handover_queue(
    session: AsyncSession, *, tenant_id: str | UUID,
) -> ProjectQueueResponse:
    """NSO Handover tab — project-completed sites awaiting the supervisor's push
    to NSO (admin-confirmed → project done, not yet pushed)."""
    rows = (await session.execute(
        select(models.Site, models.ProjectReview)
        .join(models.ProjectReview, models.ProjectReview.site_id == models.Site.id)
        .where(
            models.Site.tenant_id == tenant_id,
            models.ProjectReview.project_status == "done",
            models.ProjectReview.nso_status == "pending",
        )
        .order_by(models.ProjectReview.project_completed_at.desc())
    )).all()
    delegates, names = await _batch_project_prefetch(session, [site for site, _r in rows])
    items = [
        await _queue_item(session, site, review, prefetched={
            "delegate": delegates.get(site.id),
            "submitted_by_name": names.get(site.submitted_by, ""),
        })
        for (site, review) in rows
    ]
    return ProjectQueueResponse(items=items, total=len(items))


async def svc_push_to_nso(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict, site_id: str | UUID,
) -> ProjectStateResponse:
    """Supervisor pushes a project-completed site from the NSO Handover tab into
    NSO, opening the NSO record directly at stage three."""
    from app.services import nso_service  # local import avoids an import cycle
    if not _is_supervisor(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a project supervisor can push to NSO.")
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        review = await _fetch_review_or_create(session, site=site)
        if review.project_status != "done":
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Project is not complete yet.")
        if review.nso_status == "pushed":
            raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail="Site is already pushed to NSO.")
        await nso_service.svc_open_nso_at_stage_three(session, site=site, project=review)
        review.nso_status = "pushed"
        review.pushed_to_nso_at = datetime.now(timezone.utc)
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="project_pushed_to_nso",
            detail="Pushed from NSO Handover tab — NSO opened at stage three",
        )
        return await _build_response(session, site, review)


async def svc_quality_audit_admin_queue(
    session: AsyncSession, *, tenant_id: str | UUID,
) -> ProjectQueueResponse:
    """Sites awaiting business_admin quality-audit confirmation (supervisor-approved)."""
    rows = (await session.execute(
        select(models.Site, models.ProjectReview)
        .join(models.ProjectReview, models.ProjectReview.site_id == models.Site.id)
        .where(
            models.Site.tenant_id == tenant_id,
            models.ProjectReview.quality_audit_status == "supervisor_approved",
        )
        .order_by(models.ProjectReview.quality_audit_supervisor_approved_at.asc())
    )).all()
    delegates, names = await _batch_project_prefetch(session, [site for site, _r in rows])
    items = [
        await _queue_item(session, site, review, prefetched={
            "delegate": delegates.get(site.id),
            "submitted_by_name": names.get(site.submitted_by, ""),
        })
        for (site, review) in rows
    ]
    return ProjectQueueResponse(items=items, total=len(items))


async def svc_pe_quality_audit_queue(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    restrict_to_site_ids: Optional[list[str]] = None,
) -> ProjectQueueResponse:
    """Project-Excellence 'Quality Audit' tab — sites whose quality audit the
    project supervisor has approved (awaiting the PE supervisor's 'Completed'),
    plus the recently-completed ones so the tab doubles as a status view.

    `restrict_to_site_ids` scopes the queue to an executive's allocated sites
    (None = unrestricted, for supervisors) — mirrors svc_pe_queue so executives
    can't see sites outside their Project-Excellence allocations.
    """
    if restrict_to_site_ids is not None and not restrict_to_site_ids:
        return ProjectQueueResponse(items=[], total=0)
    stmt = (
        select(models.Site, models.ProjectReview)
        .join(models.ProjectReview, models.ProjectReview.site_id == models.Site.id)
        .where(
            models.Site.tenant_id == tenant_id,
            models.ProjectReview.quality_audit_status.in_(("supervisor_approved", "approved")),
        )
    )
    if restrict_to_site_ids is not None:
        stmt = stmt.where(models.Site.id.in_(restrict_to_site_ids))
    rows = (await session.execute(
        stmt.order_by(models.ProjectReview.quality_audit_supervisor_approved_at.asc())
    )).all()
    delegates, names = await _batch_project_prefetch(session, [site for site, _r in rows])
    items = [
        await _queue_item(session, site, review, prefetched={
            "delegate": delegates.get(site.id),
            "submitted_by_name": names.get(site.submitted_by, ""),
        })
        for (site, review) in rows
    ]
    return ProjectQueueResponse(items=items, total=len(items))


async def svc_pe_complete_quality_audit(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict, site_id: str | UUID,
) -> ProjectStateResponse:
    """Project-Excellence supervisor marks the quality audit Completed.

    This is the final quality-audit sign-off (it replaced the business-admin
    confirmation): supervisor-approved → the project COMPLETES, recording the
    completion timestamp. The site does NOT auto-push to NSO — the project
    supervisor still pushes it from the Project module's 'NSO Handover' tab,
    which is the only thing that opens NSO stage three (see svc_push_to_nso).
    """
    if not _is_supervisor(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a project excellence supervisor can complete the quality audit.")
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        review = await _fetch_review_or_create(session, site=site)
        if review.quality_audit_status != "supervisor_approved":
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Quality audit is not awaiting completion.")
        now = datetime.now(timezone.utc)
        review.quality_audit_status = "approved"
        review.quality_audit_admin_confirmed_at = now
        review.quality_audit_admin_confirmed_by = actor["sub"]
        review.project_status = "done"
        review.current_stage = "done"
        review.project_completed_at = now
        site.project_status = "done"          # keep the sites mirror in sync (#134)
        site.project_completed_at = now
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="pe_quality_audit_completed",
            detail="Project Excellence supervisor marked the quality audit completed",
        )
        return await _build_response(session, site, review)
