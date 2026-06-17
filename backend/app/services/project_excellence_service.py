"""Project Excellence service — the post-GFC budget phase.

Project Excellence owns the ``gfc`` phase of the SHARED site budget
(``site_budgets`` / ``site_budget_items`` via :mod:`app.services.budget_service`).
It unlocks the moment Design GFC is approved (``sites.design_status='approved'``),
*before* project execution — the approved budget is then shown read-only inside
the Project module. Flow: supervisor delegates (or self) → executive fills the 11
items → supervisor review → business_admin review → approved.
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
from app.domain.schemas.project_excellence import (
    AdminBudgetReviewRequest,
    PEBudgetAdminQueueResponse,
    PEBudgetItemOut,
    PEQueueItem,
    PEQueueResponse,
    PEStateResponse,
    ReviewRequest,
    SavePEBudgetRequest,
)
from app.services import budget_service, project_service
from app.services._common import fetch_site_or_404, fetch_user_name
from app.services.audit_service import write_audit_event
from app.services.delegation_service import svc_is_delegated

_PHASE = budget_service.GFC


def _is_supervisor(actor: dict) -> bool:
    return (actor.get("role") or "").lower() == "supervisor"


def _is_business_admin(actor: dict) -> bool:
    return (actor.get("role") or "").lower() == "business_admin"


def _assert_pe_unlocked(site: models.Site) -> None:
    if (site.design_status or "pending") != "approved":
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Project Excellence is locked until Design GFC is approved.",
        )


def _excellence_status(budget: Optional[models.SiteBudget], *, has_delegate: bool) -> str:
    """Derive the dashboard 'excellence' chip from the shared budget state."""
    status = budget.status if budget else "draft"
    if status == "approved":
        return "approved"
    if status in {"pending_supervisor", "pending_admin"}:
        return "budgeting"
    if budget is not None and budget.budget_total is not None:
        return "budgeting"
    if has_delegate or (budget is not None and budget.allocated_to is not None):
        return "allocated"
    return "pending"


async def _active_pe_delegate(
    session: AsyncSession, *, site_id: str | UUID,
) -> Optional[tuple[UUID, str, str]]:
    row = (await session.execute(
        select(models.SiteDelegation.delegate_user_id, models.User.name, models.User.email)
        .join(models.User, models.User.id == models.SiteDelegation.delegate_user_id)
        .where(
            models.SiteDelegation.site_id == site_id,
            models.SiteDelegation.module == "project_excellence",
            models.SiteDelegation.revoked_at.is_(None),
        )
        .order_by(models.SiteDelegation.granted_at.desc())
        .limit(1)
    )).first()
    return (row[0], row[1], row[2]) if row else None


async def _budget_item_out(
    session: AsyncSession, *, budget: Optional[models.SiteBudget],
) -> list[PEBudgetItemOut]:
    if budget is None:
        return []
    items = await budget_service.budget_items(session, budget_id=budget.id, tenant_id=budget.tenant_id)
    return [
        PEBudgetItemOut(
            id=str(row.id),
            idx=row.idx,
            label=row.label,
            amount=float(row.amount) if row.amount is not None else None,
        )
        for row in items
    ]


async def _batch_pe_prefetch(
    session: AsyncSession, sites: list[models.Site],
) -> tuple[dict, dict]:
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
            models.SiteDelegation.module == "project_excellence",
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


def _queue_item(
    site: models.Site,
    budget: Optional[models.SiteBudget],
    *,
    delegate: Optional[tuple],
    submitted_by_name: Optional[str],
) -> PEQueueItem:
    return PEQueueItem(
        site_id=str(site.id),
        site_code=site.ca_code or site.code or "",
        site_name=site.name,
        city=site.city,
        project_status=site.project_status or "pending",
        excellence_status=_excellence_status(budget, has_delegate=delegate is not None),
        budget_status=(budget.status if budget else "draft"),
        allocated_to_name=(delegate[1] if delegate else None),
        submitted_by_name=submitted_by_name,
        budget_total=float(budget.budget_total) if budget and budget.budget_total is not None else None,
    )


async def _build_response(
    session: AsyncSession, site: models.Site, budget: models.SiteBudget,
) -> PEStateResponse:
    delegate = await _active_pe_delegate(session, site_id=site.id)
    return PEStateResponse(
        site_id=str(site.id),
        site_code=site.ca_code or site.code or "",
        site_name=site.name,
        city=site.city,
        tenant_id=str(site.tenant_id),
        submitted_by_name=await fetch_user_name(session, site.submitted_by),
        site_status=site.status,
        project_status=site.project_status or "pending",
        excellence_status=_excellence_status(budget, has_delegate=delegate is not None),
        current_stage="done" if budget.status == "approved" else "budget",
        allocated_to=str(budget.allocated_to) if budget.allocated_to else None,
        allocated_to_name=(delegate[1] if delegate else None),
        budget_status=budget.status,
        budget_total=float(budget.budget_total) if budget.budget_total is not None else None,
        total_indoor_area_sqft=float(budget.total_indoor_area_sqft) if budget.total_indoor_area_sqft is not None else None,
        total_area_sqft=float(budget.total_area_sqft) if budget.total_area_sqft is not None else None,
        covers=int(budget.covers) if budget.covers is not None else None,
        budget_items=await _budget_item_out(session, budget=budget),
        budget_supervisor_comments=budget.supervisor_comments,
        budget_admin_comments=budget.admin_comments,
        updated_at=budget.updated_at,
    )


async def _assert_can_work_pe(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
) -> None:
    if _is_supervisor(actor):
        return
    if (actor.get("role") or "").lower() != "executive":
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Project Excellence access denied.")
    allowed = await svc_is_delegated(
        session,
        tenant_id=tenant_id,
        site_id=site_id,
        user_id=actor["sub"],
        module="project_excellence",
    )
    if not allowed:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Executive is not allocated to this Project Excellence site.",
        )


async def svc_pe_queue(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    restrict_to_site_ids: Optional[list[str]] = None,
    limit: int = 50,
    offset: int = 0,
) -> PEQueueResponse:
    """Return one page of the Project Excellence queue, oldest-updated first.

    Paginated (``limit``/``offset``) so the queue and its per-row budget
    enrichment are bounded by page size (#230). Executive scoping is applied
    before pagination. ``total`` is the page row count.
    """
    async with transaction(session):
        stmt = (
            select(models.Site, models.SiteBudget)
            .outerjoin(
                models.SiteBudget,
                (models.SiteBudget.site_id == models.Site.id)
                & (models.SiteBudget.phase == _PHASE),
            )
            .where(
                models.Site.tenant_id == tenant_id,
                models.Site.design_status == "approved",
            )
        )
        if restrict_to_site_ids is not None:
            if not restrict_to_site_ids:
                return PEQueueResponse(items=[], total=0)
            stmt = stmt.where(models.Site.id.in_(restrict_to_site_ids))
        rows = (await session.execute(
            stmt.order_by(models.Site.updated_at.asc(), models.Site.id).limit(limit).offset(offset)
        )).all()

        delegates, names = await _batch_pe_prefetch(session, [site for site, _b in rows])
        items = [
            _queue_item(
                site, budget,
                delegate=delegates.get(site.id),
                submitted_by_name=names.get(site.submitted_by, ""),
            )
            for site, budget in rows
        ]
        return PEQueueResponse(items=items, total=len(items))


async def svc_get_pe(
    session: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID,
) -> PEStateResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        _assert_pe_unlocked(site)
        budget = await budget_service.fetch_or_create_budget(session, site=site, phase=_PHASE)
        return await _build_response(session, site, budget)


async def svc_list_pe_delegations_for_site(
    session: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID,
) -> dict:
    stmt = (
        select(models.SiteDelegation, models.User.email, models.User.name)
        .join(models.User, models.User.id == models.SiteDelegation.delegate_user_id)
        .where(
            models.SiteDelegation.site_id == site_id,
            models.SiteDelegation.tenant_id == tenant_id,
            models.SiteDelegation.module == "project_excellence",
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


async def svc_allocate_pe(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    delegate_user_id: str | UUID,
    notes: Optional[str] = None,
) -> PEStateResponse:
    if not _is_supervisor(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a project excellence supervisor can allocate.")
    if str(delegate_user_id) == str(actor["sub"]):
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail="Cannot allocate to yourself.")

    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        _assert_pe_unlocked(site)
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
                models.SiteDelegation.module == "project_excellence",
                models.SiteDelegation.delegate_user_id == delegate_user_id,
                models.SiteDelegation.revoked_at.is_(None),
            )
        )).scalar_one_or_none()
        if existing is not None:
            raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail="Project Excellence allocation already exists.")

        row = models.SiteDelegation(
            tenant_id=tenant_id,
            site_id=site.id,
            module="project_excellence",
            delegate_user_id=delegate_user_id,
            granted_by=actor["sub"],
            notes=(notes or "").strip() or None,
        )
        session.add(row)
        budget = await budget_service.fetch_or_create_budget(session, site=site, phase=_PHASE)
        budget.allocated_to = delegate.id
        site.project_excellence_status = "allocated"
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="pe_allocated",
            detail=f"delegate={delegate.email}",
        )
        return await _build_response(session, site, budget)


async def svc_revoke_pe_delegation(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    delegate_user_id: str | UUID,
) -> OkResponse:
    if not _is_supervisor(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a project excellence supervisor can revoke.")
    async with transaction(session):
        row = (await session.execute(
            select(models.SiteDelegation).where(
                models.SiteDelegation.tenant_id == tenant_id,
                models.SiteDelegation.site_id == site_id,
                models.SiteDelegation.module == "project_excellence",
                models.SiteDelegation.delegate_user_id == delegate_user_id,
                models.SiteDelegation.revoked_at.is_(None),
            )
        )).scalar_one_or_none()
        if row is None:
            return OkResponse(message="No active project excellence allocation to revoke.")
        row.revoked_at = datetime.now(timezone.utc)
        row.revoked_by = actor["sub"]
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=row.site_id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="pe_allocation_revoked",
        )
    return OkResponse(message="Project Excellence allocation revoked.")


async def svc_save_pe_budget(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: SavePEBudgetRequest,
) -> PEStateResponse:
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        _assert_pe_unlocked(site)
        await _assert_can_work_pe(session, tenant_id=tenant_id, actor=actor, site_id=site.id)
        budget = await budget_service.fetch_or_create_budget(session, site=site, phase=_PHASE)
        if budget.status not in {"draft", "rejected"}:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Budget is already {budget.status}.",
            )

        labels = {item.idx: item.label for item in body.items if item.label}
        amounts = {item.idx: item.amount for item in body.items}
        total = await budget_service.replace_budget_items(
            session, budget=budget, amounts=amounts, labels=labels,
        )
        budget.total_indoor_area_sqft = body.total_indoor_area_sqft
        budget.total_area_sqft = body.total_area_sqft
        budget.covers = body.covers
        site.project_excellence_status = "budgeting"
        if body.action == "submit":
            budget.status = "pending_admin" if _is_supervisor(actor) else "pending_supervisor"
        else:
            budget.status = "draft"
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="pe_budget_saved" if body.action == "save" else "pe_budget_submitted",
            detail=f"total={total} status={budget.status}",
        )
        await session.flush()
        return await _build_response(session, site, budget)


async def svc_review_pe_budget(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: ReviewRequest,
) -> PEStateResponse:
    if not _is_supervisor(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a project excellence supervisor can review budgets.")
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        budget = await budget_service.fetch_or_create_budget(session, site=site, phase=_PHASE)
        if budget.status != "pending_supervisor":
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Budget is not awaiting supervisor.")
        if body.decision == "approve":
            budget.status = "pending_admin"
        else:
            budget.status = "rejected"
            budget.supervisor_comments = (body.comments or "").strip() or "Rejected by supervisor."
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="pe_budget_supervisor_reviewed",
            detail=f"decision={body.decision}",
        )
        return await _build_response(session, site, budget)


async def svc_pe_budget_admin_queue(
    session: AsyncSession, *, tenant_id: str | UUID,
) -> PEBudgetAdminQueueResponse:
    rows = (await session.execute(
        select(models.Site, models.SiteBudget)
        .join(
            models.SiteBudget,
            (models.SiteBudget.site_id == models.Site.id)
            & (models.SiteBudget.phase == _PHASE),
        )
        .where(
            models.Site.tenant_id == tenant_id,
            models.SiteBudget.status == "pending_admin",
        )
        .order_by(models.SiteBudget.updated_at.asc())
    )).all()
    delegates, names = await _batch_pe_prefetch(session, [site for site, _b in rows])
    items = [
        _queue_item(
            site, budget,
            delegate=delegates.get(site.id),
            submitted_by_name=names.get(site.submitted_by, ""),
        )
        for (site, budget) in rows
    ]
    return PEBudgetAdminQueueResponse(items=items, total=len(items))


async def svc_admin_review_pe_budget(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    body: AdminBudgetReviewRequest,
) -> PEStateResponse:
    if not _is_business_admin(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a business admin can review project excellence budgets.")
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        budget = await budget_service.fetch_or_create_budget(session, site=site, phase=_PHASE)
        if budget.status != "pending_admin":
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Budget is not awaiting admin.")
        if body.decision == "approve":
            # The init date is mandatory on approval: it hands the site to the
            # Project module and proposes the date the executive will confirm.
            if body.initialization_date is None:
                raise HTTPException(
                    status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Set the project initialization date to approve.",
                )
            budget.status = "approved"
            budget.approved_at = datetime.now(timezone.utc)
            site.project_excellence_status = "approved"
            # Hand over to the Project module: seed the proposed initialization
            # date in the same transaction so approval + handover are atomic.
            await project_service.seed_initialization_from_pe(
                session, site=site, initialization_date=body.initialization_date,
            )
        else:
            budget.status = "rejected"
            budget.admin_comments = (body.comments or "").strip() or "Rejected by business admin."
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="pe_budget_admin_reviewed",
            detail=f"decision={body.decision}",
        )
        return await _build_response(session, site, budget)


async def svc_get_pe_budget_admin_detail(
    session: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID,
) -> PEStateResponse:
    site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
    budget = await budget_service.fetch_budget(session, site_id=site.id, phase=_PHASE, tenant_id=tenant_id)
    if budget is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Project Excellence budget details are not available for this site.",
        )
    return await _build_response(session, site, budget)
