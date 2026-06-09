"""Project Execution service.

Opens after Design reaches GFC approval (`sites.design_status = 'approved'`).
The module owns granular project state in `project_reviews` and
`project_budget_items`; the parent `sites` row remains the cross-module ticket.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Optional
from uuid import UUID, uuid4

from fastapi import HTTPException, status as http_status
from sqlalchemy import delete, desc, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.db.session import transaction
from app.domain.schemas.common import OkResponse
from app.domain.schemas.project import (
    AdminBudgetReviewRequest,
    InitializationFinalizeRequest,
    InitializationRespondRequest,
    MidVisitRequest,
    MilestoneRequest,
    ProjectBudgetAdminQueueResponse,
    ProjectHistoryItem,
    ProjectHistoryResponse,
    ProjectBudgetItemOut,
    ProjectQueueItem,
    ProjectQueueResponse,
    ProjectStateResponse,
    ReviewRequest,
    SaveBudgetRequest,
)
from app.services._common import fetch_site_or_404, fetch_user_name
from app.services.audit_service import write_audit_event
from app.services.delegation_service import svc_assigned_sites, svc_is_delegated
from app.services.storage_service import safe_object_name, signed_url, upload_bytes


_BUDGET_LABELS = (
    "Professional Fees",
    "HVAC",
    "Furniture, Light & Planters",
    "Civil & Interiors",
    "Kitchen Equipment",
    "Branding",
    "Crockery & Small Equipments",
    "Utilities",
    "Licencing",
    "BD Cost",
    "Misc",
)


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
        current_stage="budget",
    )
    session.add(review)
    await session.flush()
    return review


async def _budget_items(
    session: AsyncSession, *, site_id: str | UUID,
) -> list[models.ProjectBudgetItem]:
    rows = (await session.execute(
        select(models.ProjectBudgetItem)
        .where(models.ProjectBudgetItem.site_id == site_id)
        .order_by(models.ProjectBudgetItem.idx.asc())
    )).scalars().all()
    return list(rows)


def _budget_item_out(row: models.ProjectBudgetItem) -> ProjectBudgetItemOut:
    return ProjectBudgetItemOut(
        id=str(row.id),
        idx=row.idx,
        label=row.label,
        amount=float(row.amount) if row.amount is not None else None,
    )


async def _queue_item(
    session: AsyncSession, site: models.Site, review: Optional[models.ProjectReview],
) -> ProjectQueueItem:
    delegate = await _active_project_delegate(session, site_id=site.id)
    return ProjectQueueItem(
        site_id=str(site.id),
        site_code=site.ca_code or site.code or "",
        site_name=site.name,
        city=site.city,
        design_status=site.design_status or "pending",
        project_status=(review.project_status if review else "pending"),
        current_stage=(review.current_stage if review else "budget"),
        budget_status=(review.budget_status if review else "draft"),
        allocated_to_name=(delegate[1] if delegate else None),
        submitted_by_name=await fetch_user_name(session, site.submitted_by),
    )


async def _quality_audit_download_url(
    session: AsyncSession, *, site_id: str | UUID,
) -> Optional[str]:
    """Short-lived signed URL for the most recent quality-audit report file."""
    row = (await session.execute(
        select(models.SiteFile)
        .where(
            models.SiteFile.site_id == site_id,
            models.SiteFile.file_type == "quality_audit",
        )
        .order_by(models.SiteFile.uploaded_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    if row is None:
        return None
    return await signed_url(row.storage_path)


async def _build_response(
    session: AsyncSession, site: models.Site, review: models.ProjectReview,
) -> ProjectStateResponse:
    delegate = await _active_project_delegate(session, site_id=site.id)
    items = await _budget_items(session, site_id=site.id)
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
        budget_status=review.budget_status,
        budget_total=float(review.budget_total) if review.budget_total is not None else None,
        total_indoor_area_sqft=float(review.total_indoor_area_sqft) if review.total_indoor_area_sqft is not None else None,
        total_area_sqft=float(review.total_area_sqft) if review.total_area_sqft is not None else None,
        covers=int(review.covers) if review.covers is not None else None,
        budget_items=[_budget_item_out(item) for item in items],
        budget_supervisor_comments=review.budget_supervisor_comments,
        budget_admin_comments=review.budget_admin_comments,
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
        quality_audit_download_url=await _quality_audit_download_url(session, site_id=site.id),
        final_completion_date=review.final_completion_date,
        project_completed_at=review.project_completed_at,
        nso_status=review.nso_status,
        pushed_to_nso_at=review.pushed_to_nso_at,
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
) -> ProjectQueueResponse:
    async with transaction(session):
        stmt = (
            select(models.Site)
            .where(
                models.Site.tenant_id == tenant_id,
                models.Site.design_status == "approved",
            )
            .order_by(models.Site.updated_at.asc())
        )
        if restrict_to_site_ids is not None:
            if not restrict_to_site_ids:
                return ProjectQueueResponse(items=[], total=0)
            stmt = stmt.where(models.Site.id.in_(restrict_to_site_ids))
        sites = (await session.execute(stmt)).scalars().all()
        items: list[ProjectQueueItem] = []
        for site in sites:
            review = await _fetch_review_or_create(session, site=site)
            if review.project_status == "done":
                continue
            items.append(await _queue_item(session, site, review))
        return ProjectQueueResponse(items=items, total=len(items))


async def svc_project_history(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    status_filter: str = "all",
    restrict_to_site_ids: Optional[list[str]] = None,
) -> ProjectHistoryResponse:
    """Read-only Project history for sites that reached or entered Project.

    Executives pass `restrict_to_site_ids` (their project-delegated sites); a
    supervisor passes None and sees the whole tenant's project history.
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
                models.ProjectReview.project_status.in_(["pending", "allocated", "budgeting", "in_progress"]),
            )
        )
    elif status_filter in {"approved", "completed"}:
        stmt = stmt.where(models.ProjectReview.project_status == "done")
    elif status_filter == "rejected":
        stmt = stmt.where(models.ProjectReview.budget_status == "rejected")

    if restrict_to_site_ids is not None:
        stmt = stmt.where(models.Site.id.in_(restrict_to_site_ids))

    rows = (await session.execute(
        stmt.order_by(
            desc(models.ProjectReview.updated_at).nulls_last(),
            desc(models.Site.updated_at),
        )
    )).all()

    items: list[ProjectHistoryItem] = []
    for site, review in rows:
        items.append(ProjectHistoryItem(
            site_id=str(site.id),
            site_code=site.ca_code or site.code or "",
            site_name=site.name,
            city=site.city,
            submitted_by_name=await fetch_user_name(session, site.submitted_by),
            design_status=site.design_status or "pending",
            project_status=(review.project_status if review else "pending"),
            current_stage=(review.current_stage if review else "budget"),
            budget_status=(review.budget_status if review else "draft"),
            project_completed_at=(review.project_completed_at if review else None),
            updated_at=(review.updated_at if review else site.updated_at),
        ))
    return ProjectHistoryResponse(items=items, total=len(items))


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
            current_stage="budget",
            budget_status="draft",
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
        review.current_stage = "budget"
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


async def svc_save_budget(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: SaveBudgetRequest,
) -> ProjectStateResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        _assert_project_unlocked(site)
        await _assert_can_work_project(session, tenant_id=tenant_id, actor=actor, site_id=site.id)
        review = await _fetch_review_or_create(session, site=site)
        if review.budget_status not in {"draft", "rejected"}:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Budget is already {review.budget_status}.",
            )

        labels = {item.idx: (item.label or _BUDGET_LABELS[item.idx - 1]) for item in body.items}
        amounts = {item.idx: item.amount for item in body.items}
        await session.execute(delete(models.ProjectBudgetItem).where(models.ProjectBudgetItem.site_id == site.id))
        total = 0.0
        for idx in range(1, len(_BUDGET_LABELS) + 1):
            amount = amounts.get(idx)
            if amount is not None:
                total += float(amount)
            session.add(models.ProjectBudgetItem(
                tenant_id=tenant_id,
                site_id=site.id,
                idx=idx,
                label=labels.get(idx, _BUDGET_LABELS[idx - 1]),
                amount=amount,
            ))
        review.budget_total = total
        review.total_indoor_area_sqft = body.total_indoor_area_sqft
        review.total_area_sqft = body.total_area_sqft
        review.covers = body.covers
        review.project_status = "budgeting"
        review.current_stage = "budget"
        if body.action == "submit":
            review.budget_status = "pending_admin" if _is_supervisor(actor) else "pending_supervisor"
        else:
            review.budget_status = "draft"
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="project_budget_saved" if body.action == "save" else "project_budget_submitted",
            detail=f"total={total} status={review.budget_status}",
        )
        await session.flush()
        return await _build_response(session, site, review)


async def svc_review_budget(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: ReviewRequest,
) -> ProjectStateResponse:
    if not _is_supervisor(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a project supervisor can review budgets.")
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        review = await _fetch_review_or_create(session, site=site)
        if review.budget_status != "pending_supervisor":
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Budget is not awaiting supervisor.")
        if body.decision == "approve":
            review.budget_status = "pending_admin"
        else:
            review.budget_status = "rejected"
            review.budget_supervisor_comments = (body.comments or "").strip() or "Rejected by project supervisor."
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="project_budget_supervisor_reviewed",
            detail=f"decision={body.decision}",
        )
        return await _build_response(session, site, review)


async def svc_budget_admin_queue(
    session: AsyncSession, *, tenant_id: str | UUID,
) -> ProjectBudgetAdminQueueResponse:
    try:
        rows = (await session.execute(
            select(models.Site, models.ProjectReview)
            .join(models.ProjectReview, models.ProjectReview.site_id == models.Site.id)
            .where(
                models.Site.tenant_id == tenant_id,
                models.ProjectReview.budget_status == "pending_admin",
            )
            .order_by(models.ProjectReview.updated_at.asc())
        )).all()
    except SQLAlchemyError:
        await session.rollback()
        return ProjectBudgetAdminQueueResponse(items=[], total=0)
    items = [await _queue_item(session, site, review) for (site, review) in rows]
    return ProjectBudgetAdminQueueResponse(items=items, total=len(items))


async def svc_admin_review_budget(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: AdminBudgetReviewRequest,
) -> ProjectStateResponse:
    if not _is_business_admin(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a business admin can review project budgets.")
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        review = await _fetch_review_or_create(session, site=site)
        if review.budget_status != "pending_admin":
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Budget is not awaiting admin.")
        if body.decision == "approve":
            review.budget_status = "approved"
            review.project_status = "in_progress"
            review.current_stage = "execution"
            # The admin sets the project initialization date here (UI defaults
            # it to today + 2 days). It then goes to the executive to accept/
            # reject, so the status becomes 'proposed'.
            review.initialization_date = body.initialization_date or (date.today() + timedelta(days=2))
            review.initialization_status = "proposed"
        else:
            review.budget_status = "rejected"
            review.budget_admin_comments = (body.comments or "").strip() or "Rejected by business admin."
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="project_budget_admin_reviewed",
            detail=f"decision={body.decision}",
        )
        return await _build_response(session, site, review)


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
        if review.budget_status != "approved":
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Execution is locked until budget approval.")
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


async def svc_submit_quality_audit_report(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    filename: str,
    content_type: Optional[str],
    file_bytes: bytes,
    inspection_date: Optional[date],
) -> ProjectStateResponse:
    """Executive uploads the quality-audit report + inspection date, then submits for review."""
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        await _assert_can_work_project(session, tenant_id=tenant_id, actor=actor, site_id=site.id)
        review = await _fetch_review_or_create(session, site=site)
        if review.mid_project_visit_date is None:
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Mid-project visit date must be set before the quality audit.")
        if inspection_date is None:
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Inspection date is required.")
        file_id = uuid4()
        safe_name = f"{file_id.hex[:8]}_{safe_object_name(filename, fallback='quality_audit')}"
        storage_path = f"quality_audit/{site.id}/{safe_name}"
        await upload_bytes(
            path=storage_path,
            body=file_bytes,
            content_type=content_type or "application/pdf",
        )
        session.add(models.SiteFile(
            id=file_id,
            tenant_id=tenant_id,
            site_id=site.id,
            uploaded_by=actor["sub"],
            file_type="quality_audit",
            file_name=filename,
            storage_path=storage_path,
            file_size_kb=max(1, len(file_bytes) // 1024),
            mime_type=content_type,
            is_primary=True,
            source="manual_upload",
        ))
        review.inspection_date = inspection_date
        review.quality_audit_status = "submitted"
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="project_quality_audit_uploaded",
            detail=f"file={filename} inspection_date={inspection_date}",
        )
        return await _build_response(session, site, review)


async def svc_review_quality_audit(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: ReviewRequest,
) -> ProjectStateResponse:
    if not _is_supervisor(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a project supervisor can review quality audit.")
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        review = await _fetch_review_or_create(session, site=site)
        if review.quality_audit_status != "submitted":
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Quality audit is not awaiting review.")
        if body.decision == "approve":
            # Audit approved → complete the project and push the site to NSO.
            now = datetime.now(timezone.utc)
            review.quality_audit_status = "approved"
            review.project_status = "done"
            review.current_stage = "done"
            review.project_completed_at = now
            review.nso_status = "pushed"
            review.pushed_to_nso_at = now
        else:
            review.quality_audit_status = "rejected"
            review.quality_audit_comments = (body.comments or "").strip() or "Rejected by supervisor."
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="project_quality_audit_reviewed",
            detail=f"decision={body.decision}",
        )
        if body.decision == "approve":
            await write_audit_event(
                session,
                tenant_id=tenant_id,
                site_id=site.id,
                actor_id=actor["sub"],
                actor_name=actor.get("name"),
                action="project_pushed_to_nso",
            )
        return await _build_response(session, site, review)


async def svc_nso_queue(
    session: AsyncSession, *, tenant_id: str | UUID,
) -> ProjectQueueResponse:
    """Sites completed in Project and pushed to NSO — the handoff queue the
    (parallel) NSO module consumes."""
    try:
        rows = (await session.execute(
            select(models.Site, models.ProjectReview)
            .join(models.ProjectReview, models.ProjectReview.site_id == models.Site.id)
            .where(
                models.Site.tenant_id == tenant_id,
                models.ProjectReview.nso_status == "pushed",
            )
            .order_by(models.ProjectReview.pushed_to_nso_at.desc())
        )).all()
    except SQLAlchemyError:
        await session.rollback()
        return ProjectQueueResponse(items=[], total=0)
    items = [await _queue_item(session, site, review) for (site, review) in rows]
    return ProjectQueueResponse(items=items, total=len(items))
