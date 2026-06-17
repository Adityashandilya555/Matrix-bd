"""Financial Closure service — the post-launch 'closure' phase of the shared budget.

After a site is launched, the business_admin sends it for financial closure. The
project team (delegate-or-self, scoped by site_delegations module='financial_closure')
re-enters the 11 budget fields as ACTUALS; each line shows the variation vs the
approved GFC budget. supervisor → business_admin sign-off, then the admin's
Financial Closure button records it and archives the site to the admin history.

Storage is the SHARED site budget (phase='closure') via :mod:`budget_service` — no
duplicate budget tables. Mirrors the Project Excellence workflow shape.
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
from app.domain.schemas.financial_closure import (
    FCAdminReviewRequest,
    FCBudgetLineOut,
    FCQueueItem,
    FCQueueResponse,
    FCReviewRequest,
    FCStateResponse,
    SaveFCBudgetRequest,
)
from app.services import budget_service
from app.services._common import count_rows, fetch_site_or_404, fetch_user_name
from app.services.audit_service import write_audit_event
from app.services.delegation_service import svc_is_delegated

_PHASE = budget_service.CLOSURE
_MODULE = "financial_closure"


def _is_supervisor(actor: dict) -> bool:
    return (actor.get("role") or "").lower() == "supervisor"


def _is_business_admin(actor: dict) -> bool:
    return (actor.get("role") or "").lower() == "business_admin"


def _assert_launched(site: models.Site) -> None:
    if not bool(site.is_launched):
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Financial Closure opens only after the site is launched.",
        )


def _assert_closure_open(site: models.Site) -> None:
    if (site.financial_closure_status or "pending") == "pending":
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Financial Closure has not been opened for this site yet.",
        )


async def _active_fc_delegate(
    session: AsyncSession, *, site_id: str | UUID,
) -> Optional[tuple[UUID, str, str]]:
    row = (await session.execute(
        select(models.SiteDelegation.delegate_user_id, models.User.name, models.User.email)
        .join(models.User, models.User.id == models.SiteDelegation.delegate_user_id)
        .where(
            models.SiteDelegation.site_id == site_id,
            models.SiteDelegation.module == _MODULE,
            models.SiteDelegation.revoked_at.is_(None),
        )
        .order_by(models.SiteDelegation.granted_at.desc())
        .limit(1)
    )).first()
    return (row[0], row[1], row[2]) if row else None


async def _build_fc_state(
    session: AsyncSession, site: models.Site, closure: Optional[models.SiteBudget],
) -> FCStateResponse:
    gfc = await budget_service.fetch_budget(session, site_id=site.id, phase=budget_service.GFC, tenant_id=site.tenant_id)
    gfc_items = {i.idx: i for i in (await budget_service.budget_items(session, budget_id=gfc.id, tenant_id=site.tenant_id) if gfc else [])}
    closure_items = {i.idx: i for i in (await budget_service.budget_items(session, budget_id=closure.id, tenant_id=site.tenant_id) if closure else [])}

    lines: list[FCBudgetLineOut] = []
    variation_total = 0.0
    for idx in range(1, len(budget_service.BUDGET_LABELS) + 1):
        g = gfc_items.get(idx)
        c = closure_items.get(idx)
        gfc_amount = float(g.amount) if g and g.amount is not None else None
        closure_amount = float(c.amount) if c and c.amount is not None else None
        variation = round((closure_amount or 0.0) - (gfc_amount or 0.0), 2)
        variation_total += variation
        label = (c.label if c else None) or (g.label if g else None) or budget_service.BUDGET_LABELS[idx - 1]
        lines.append(FCBudgetLineOut(
            idx=idx, label=label,
            gfc_amount=gfc_amount, closure_amount=closure_amount, variation=variation,
        ))

    delegate = await _active_fc_delegate(session, site_id=site.id)
    return FCStateResponse(
        site_id=str(site.id),
        site_code=site.ca_code or site.code or "",
        site_name=site.name,
        city=site.city,
        tenant_id=str(site.tenant_id),
        submitted_by_name=await fetch_user_name(session, site.submitted_by),
        is_launched=bool(site.is_launched),
        financial_closure_status=site.financial_closure_status or "pending",
        closure_status=(closure.status if closure else "draft"),
        allocated_to=str(closure.allocated_to) if closure and closure.allocated_to else None,
        allocated_to_name=(delegate[1] if delegate else None),
        gfc_budget_total=float(gfc.budget_total) if gfc and gfc.budget_total is not None else None,
        closure_budget_total=float(closure.budget_total) if closure and closure.budget_total is not None else None,
        variation_total=round(variation_total, 2),
        lines=lines,
        supervisor_comments=closure.supervisor_comments if closure else None,
        admin_comments=closure.admin_comments if closure else None,
        updated_at=closure.updated_at if closure else None,
    )


async def _assert_can_work_fc(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict, site_id: str | UUID,
) -> None:
    if _is_supervisor(actor):
        return
    if (actor.get("role") or "").lower() != "executive":
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Financial Closure access denied.")
    allowed = await svc_is_delegated(
        session, tenant_id=tenant_id, site_id=site_id, user_id=actor["sub"], module=_MODULE,
    )
    if not allowed:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Executive is not allocated to this Financial Closure site.",
        )


async def svc_send_for_financial_closure(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict, site_id: str | UUID,
) -> FCStateResponse:
    """Business admin opens Financial Closure for a launched site: creates the
    closure budget seeded from the GFC labels (amounts blank for re-entry)."""
    if not _is_business_admin(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a business admin can send a site for financial closure.")
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        _assert_launched(site)
        if (site.financial_closure_status or "pending") != "pending":
            raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail="Financial Closure is already open for this site.")
        gfc = await budget_service.fetch_budget(session, site_id=site.id, phase=budget_service.GFC, tenant_id=site.tenant_id)
        if gfc is None or gfc.status != "approved":
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Financial Closure needs an approved Project Excellence (GFC) budget as its baseline.",
            )
        closure = await budget_service.fetch_or_create_budget(session, site=site, phase=_PHASE)
        gfc_items = await budget_service.budget_items(session, budget_id=gfc.id, tenant_id=site.tenant_id)
        await budget_service.seed_items_from(session, budget=closure, source_items=gfc_items)
        site.financial_closure_status = "open"
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="financial_closure_opened",
            detail="Sent for financial closure",
        )
        return await _build_fc_state(session, site, closure)


async def svc_fc_queue(
    session: AsyncSession, *, tenant_id: str | UUID,
    restrict_to_site_ids: Optional[list[str]] = None,
    limit: int = 500,
    offset: int = 0,
) -> FCQueueResponse:
    """Return one page of the Financial Closure queue, newest-launched first.

    Paginated (``limit``/``offset``) so the queue and its per-row budget lookups
    are bounded by page size (#230). Executive scoping is applied before
    pagination. ``total`` is the page row count.
    """
    async with transaction(session):
        stmt = (
            select(models.Site, models.SiteBudget)
            .outerjoin(
                models.SiteBudget,
                (models.SiteBudget.site_id == models.Site.id) & (models.SiteBudget.phase == _PHASE),
            )
            .where(
                models.Site.tenant_id == tenant_id,
                models.Site.financial_closure_status != "pending",
            )
        )
        if restrict_to_site_ids is not None:
            if not restrict_to_site_ids:
                return FCQueueResponse(items=[], total=0)
            stmt = stmt.where(models.Site.id.in_(restrict_to_site_ids))
        total = await count_rows(session, stmt)
        rows = (await session.execute(
            stmt.order_by(models.Site.launched_at.desc(), models.Site.id).limit(limit).offset(offset)
        )).all()

        items: list[FCQueueItem] = []
        for site, closure in rows:
            variation = await budget_service.variation_vs_gfc(session, site_id=site.id, tenant_id=tenant_id)
            gfc = await budget_service.fetch_budget(session, site_id=site.id, phase=budget_service.GFC, tenant_id=tenant_id)
            delegate = await _active_fc_delegate(session, site_id=site.id)
            items.append(FCQueueItem(
                site_id=str(site.id),
                site_code=site.ca_code or site.code or "",
                site_name=site.name,
                city=site.city,
                closure_status=(closure.status if closure else "draft"),
                financial_closure_status=site.financial_closure_status or "pending",
                allocated_to_name=(delegate[1] if delegate else None),
                submitted_by_name=await fetch_user_name(session, site.submitted_by),
                gfc_budget_total=float(gfc.budget_total) if gfc and gfc.budget_total is not None else None,
                closure_budget_total=float(closure.budget_total) if closure and closure.budget_total is not None else None,
                variation_total=round(sum(variation.values()), 2),
            ))
        return FCQueueResponse(items=items, total=total)


async def svc_get_fc(
    session: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID,
) -> FCStateResponse:
    """Return the financial closure state for one site, opening its budget if absent."""
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        _assert_closure_open(site)
        closure = await budget_service.fetch_or_create_budget(session, site=site, phase=_PHASE)
        return await _build_fc_state(session, site, closure)


async def svc_list_fc_delegations_for_site(
    session: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID,
) -> dict:
    """List active financial-closure delegations for a site, newest grant first."""
    stmt = (
        select(models.SiteDelegation, models.User.email, models.User.name)
        .join(models.User, models.User.id == models.SiteDelegation.delegate_user_id)
        .where(
            models.SiteDelegation.site_id == site_id,
            models.SiteDelegation.tenant_id == tenant_id,
            models.SiteDelegation.module == _MODULE,
            models.SiteDelegation.revoked_at.is_(None),
        )
        .order_by(models.SiteDelegation.granted_at.desc())
    )
    rows = (await session.execute(stmt)).all()
    return {
        "items": [
            {
                "id": str(row.id), "site_id": str(row.site_id), "module": row.module,
                "delegate_user_id": str(row.delegate_user_id), "delegate_email": email,
                "delegate_name": name, "granted_by": str(row.granted_by),
                "granted_at": row.granted_at, "notes": row.notes,
            }
            for (row, email, name) in rows
        ],
        "total": len(rows),
    }


async def svc_allocate_fc(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict,
    site_id: str | UUID, delegate_user_id: str | UUID, notes: Optional[str] = None,
) -> FCStateResponse:
    """Delegate financial closure on a site to another user (supervisor only, not self)."""
    if not _is_supervisor(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a project supervisor can allocate financial closure.")
    if str(delegate_user_id) == str(actor["sub"]):
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail="Cannot allocate to yourself.")
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        _assert_closure_open(site)
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
                models.SiteDelegation.module == _MODULE,
                models.SiteDelegation.delegate_user_id == delegate_user_id,
                models.SiteDelegation.revoked_at.is_(None),
            )
        )).scalar_one_or_none()
        if existing is not None:
            raise HTTPException(status_code=http_status.HTTP_409_CONFLICT, detail="Financial closure allocation already exists.")
        session.add(models.SiteDelegation(
            tenant_id=tenant_id, site_id=site.id, module=_MODULE,
            delegate_user_id=delegate_user_id, granted_by=actor["sub"],
            notes=(notes or "").strip() or None,
        ))
        closure = await budget_service.fetch_or_create_budget(session, site=site, phase=_PHASE)
        closure.allocated_to = delegate.id
        site.financial_closure_status = "allocated"
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="financial_closure_allocated", detail=f"delegate={delegate.email}",
        )
        return await _build_fc_state(session, site, closure)


async def svc_revoke_fc_delegation(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict,
    site_id: str | UUID, delegate_user_id: str | UUID,
) -> OkResponse:
    """Revoke a user's active financial-closure delegation on a site (supervisor only)."""
    if not _is_supervisor(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a project supervisor can revoke financial closure.")
    async with transaction(session):
        row = (await session.execute(
            select(models.SiteDelegation).where(
                models.SiteDelegation.tenant_id == tenant_id,
                models.SiteDelegation.site_id == site_id,
                models.SiteDelegation.module == _MODULE,
                models.SiteDelegation.delegate_user_id == delegate_user_id,
                models.SiteDelegation.revoked_at.is_(None),
            )
        )).scalar_one_or_none()
        if row is None:
            return OkResponse(message="No active financial closure allocation to revoke.")
        row.revoked_at = datetime.now(timezone.utc)
        row.revoked_by = actor["sub"]
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=row.site_id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="financial_closure_allocation_revoked",
        )
    return OkResponse(message="Financial closure allocation revoked.")


async def svc_save_fc_budget(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict,
    site_id: str | UUID, body: SaveFCBudgetRequest,
) -> FCStateResponse:
    """Save or submit a closure budget; submit routes to supervisor or admin by role."""
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        _assert_closure_open(site)
        await _assert_can_work_fc(session, tenant_id=tenant_id, actor=actor, site_id=site.id)
        closure = await budget_service.fetch_or_create_budget(session, site=site, phase=_PHASE)
        if closure.status not in {"draft", "rejected"}:
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Closure budget is already {closure.status}.")
        labels = {item.idx: item.label for item in body.items if item.label}
        amounts = {item.idx: item.amount for item in body.items}
        total = await budget_service.replace_budget_items(session, budget=closure, amounts=amounts, labels=labels)
        if body.comments is not None:
            closure.supervisor_comments = (body.comments or "").strip() or None
        site.financial_closure_status = "budgeting"
        if body.action == "submit":
            closure.status = "pending_admin" if _is_supervisor(actor) else "pending_supervisor"
        else:
            closure.status = "draft"
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="financial_closure_budget_saved" if body.action == "save" else "financial_closure_budget_submitted",
            detail=f"total={total} status={closure.status}",
        )
        await session.flush()
        return await _build_fc_state(session, site, closure)


async def svc_review_fc_budget(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict,
    site_id: str | UUID, body: FCReviewRequest,
) -> FCStateResponse:
    """Supervisor review of a submitted closure budget; approve escalates to admin, else reject."""
    if not _is_supervisor(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a project supervisor can review financial closure.")
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        closure = await budget_service.fetch_or_create_budget(session, site=site, phase=_PHASE)
        if closure.status != "pending_supervisor":
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Closure budget is not awaiting supervisor.")
        if body.decision == "approve":
            closure.status = "pending_admin"
        else:
            closure.status = "rejected"
            closure.supervisor_comments = (body.comments or "").strip() or "Rejected by supervisor."
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="financial_closure_supervisor_reviewed", detail=f"decision={body.decision}",
        )
        return await _build_fc_state(session, site, closure)


async def svc_fc_admin_queue(
    session: AsyncSession, *, tenant_id: str | UUID,
    limit: int = 500, offset: int = 0,
) -> FCQueueResponse:
    """Return one page of the FC admin queue (sites pending admin), oldest first.

    Paginated (``limit``/``offset``) so the queue and its per-row budget lookups
    are bounded by page size (#230). ``total`` is the page row count.
    """
    stmt = (
        select(models.Site, models.SiteBudget)
        .join(models.SiteBudget, (models.SiteBudget.site_id == models.Site.id) & (models.SiteBudget.phase == _PHASE))
        .where(
            models.Site.tenant_id == tenant_id,
            models.SiteBudget.status == "pending_admin",
        )
        .order_by(models.SiteBudget.updated_at.asc(), models.SiteBudget.id)  # id = stable-paging tie-breaker
    )
    total = await count_rows(session, stmt)
    rows = (await session.execute(stmt.limit(limit).offset(offset))).all()
    items: list[FCQueueItem] = []
    for site, closure in rows:
        variation = await budget_service.variation_vs_gfc(session, site_id=site.id, tenant_id=tenant_id)
        gfc = await budget_service.fetch_budget(session, site_id=site.id, phase=budget_service.GFC, tenant_id=tenant_id)
        delegate = await _active_fc_delegate(session, site_id=site.id)
        items.append(FCQueueItem(
            site_id=str(site.id), site_code=site.ca_code or site.code or "",
            site_name=site.name, city=site.city,
            closure_status=closure.status,
            financial_closure_status=site.financial_closure_status or "pending",
            allocated_to_name=(delegate[1] if delegate else None),
            submitted_by_name=await fetch_user_name(session, site.submitted_by),
            gfc_budget_total=float(gfc.budget_total) if gfc and gfc.budget_total is not None else None,
            closure_budget_total=float(closure.budget_total) if closure.budget_total is not None else None,
            variation_total=round(sum(variation.values()), 2),
        ))
    return FCQueueResponse(items=items, total=total)


async def svc_admin_finalize_fc(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict,
    site_id: str | UUID, body: FCAdminReviewRequest,
) -> FCStateResponse:
    """The business_admin's Financial Closure button — records the closure (with
    variation) and archives the site to the admin-panel history."""
    if not _is_business_admin(actor):
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only a business admin can finalize financial closure.")
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
        closure = await budget_service.fetch_or_create_budget(session, site=site, phase=_PHASE)
        if closure.status != "pending_admin":
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Closure budget is not awaiting admin.")
        if body.decision == "approve":
            closure.status = "approved"
            closure.approved_at = datetime.now(timezone.utc)
            site.financial_closure_status = "closed"
        else:
            closure.status = "rejected"
            closure.admin_comments = (body.comments or "").strip() or "Rejected by business admin."
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="financial_closure_finalized", detail=f"decision={body.decision}",
        )
        return await _build_fc_state(session, site, closure)


async def svc_get_fc_admin_detail(
    session: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID,
) -> FCStateResponse:
    """Return the closure state for an admin detail view, 404 if closure was never opened."""
    site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
    closure = await budget_service.fetch_budget(session, site_id=site.id, phase=_PHASE, tenant_id=tenant_id)
    if closure is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Financial closure has not been opened for this site.")
    return await _build_fc_state(session, site, closure)
