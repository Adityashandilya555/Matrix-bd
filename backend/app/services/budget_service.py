"""Shared site-budget service — the 11-item budget is a module-agnostic entity.

Two phases live in `site_budgets` / `site_budget_items`:
  - ``gfc``     : filled by Project Excellence after Design GFC approval (the baseline).
  - ``closure`` : filled by Financial Closure after launch; each line carries a
                  variation vs the approved ``gfc`` baseline.

This module owns the budget *data* (header + 11 items + totals). The per-phase
*workflow* (who allocates, who approves) lives in the owning module's service
(``project_excellence_service`` for ``gfc``, the financial-closure flow for
``closure``), operating on ``SiteBudget.status`` through the helpers here.
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.services._common import is_unique_violation

GFC = "gfc"
CLOSURE = "closure"

# The 11 budget line items (moved out of the project module).
BUDGET_LABELS: tuple[str, ...] = (
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


async def fetch_budget(
    session: AsyncSession, *, site_id: str | UUID, phase: str, tenant_id: str | UUID,
) -> Optional[models.SiteBudget]:
    """Return the (site, phase) budget header for this tenant, or None if absent."""
    return (await session.execute(
        select(models.SiteBudget).where(
            models.SiteBudget.site_id == site_id,
            models.SiteBudget.phase == phase,
            models.SiteBudget.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()


async def fetch_or_create_budget(
    session: AsyncSession,
    *,
    site: models.Site,
    phase: str,
    allocated_to: Optional[UUID] = None,
) -> models.SiteBudget:
    """Return the (site, phase) budget header, creating an empty draft if absent."""
    budget = await fetch_budget(session, site_id=site.id, phase=phase, tenant_id=site.tenant_id)
    if budget is not None:
        return budget
    budget = models.SiteBudget(
        tenant_id=site.tenant_id,
        site_id=site.id,
        phase=phase,
        status="draft",
        allocated_to=allocated_to,
    )
    # Idempotent lazy-create — lock-free budget GETs can race on the
    # (site_id, phase) unique key. Flush in a SAVEPOINT and refetch on conflict.
    try:
        async with session.begin_nested():
            session.add(budget)
            await session.flush()
    except IntegrityError as exc:
        if not is_unique_violation(exc):
            raise
        budget = await fetch_budget(session, site_id=site.id, phase=phase, tenant_id=site.tenant_id)
        if budget is None:
            raise
    return budget


async def budget_items(
    session: AsyncSession, *, budget_id: str | UUID, tenant_id: str | UUID,
) -> list[models.SiteBudgetItem]:
    """Return a budget's line items for this tenant, ordered by line index."""
    rows = (await session.execute(
        select(models.SiteBudgetItem)
        .where(
            models.SiteBudgetItem.budget_id == budget_id,
            models.SiteBudgetItem.tenant_id == tenant_id,
        )
        .order_by(models.SiteBudgetItem.idx.asc())
    )).scalars().all()
    return list(rows)


async def replace_budget_items(
    session: AsyncSession,
    *,
    budget: models.SiteBudget,
    amounts: dict[int, Optional[float]],
    labels: Optional[dict[int, str]] = None,
) -> float:
    """Replace all 11 line items for a budget; set + return budget_total."""
    labels = labels or {}
    await session.execute(
        delete(models.SiteBudgetItem).where(models.SiteBudgetItem.budget_id == budget.id)
    )
    total = 0.0
    for idx in range(1, len(BUDGET_LABELS) + 1):
        amount = amounts.get(idx)
        if amount is not None:
            total += float(amount)
        session.add(models.SiteBudgetItem(
            tenant_id=budget.tenant_id,
            site_id=budget.site_id,
            budget_id=budget.id,
            phase=budget.phase,
            idx=idx,
            label=labels.get(idx) or BUDGET_LABELS[idx - 1],
            amount=amount,
        ))
    budget.budget_total = total
    return total


async def seed_items_from(
    session: AsyncSession,
    *,
    budget: models.SiteBudget,
    source_items: list[models.SiteBudgetItem],
) -> None:
    """Seed an empty budget's 11 rows from another phase's labels (amounts blank).

    Used when the Financial Closure phase opens: the same 11 labels appear, but
    amounts start empty so the user re-enters actuals and variation is computed.
    """
    if await budget_items(session, budget_id=budget.id, tenant_id=budget.tenant_id):
        return
    by_idx = {i.idx: i for i in source_items}
    for idx in range(1, len(BUDGET_LABELS) + 1):
        src = by_idx.get(idx)
        session.add(models.SiteBudgetItem(
            tenant_id=budget.tenant_id,
            site_id=budget.site_id,
            budget_id=budget.id,
            phase=budget.phase,
            idx=idx,
            label=(src.label if src else None) or BUDGET_LABELS[idx - 1],
            amount=None,
        ))


async def variation_vs_gfc(
    session: AsyncSession, *, site_id: str | UUID, tenant_id: str | UUID,
) -> dict[int, float]:
    """Per-idx ``closure.amount - gfc.amount`` (a missing side counts as 0)."""
    gfc = await fetch_budget(session, site_id=site_id, phase=GFC, tenant_id=tenant_id)
    closure = await fetch_budget(session, site_id=site_id, phase=CLOSURE, tenant_id=tenant_id)
    gfc_amts: dict[int, float] = {}
    closure_amts: dict[int, float] = {}
    if gfc is not None:
        gfc_amts = {i.idx: float(i.amount) if i.amount is not None else 0.0
                    for i in await budget_items(session, budget_id=gfc.id, tenant_id=tenant_id)}
    if closure is not None:
        closure_amts = {i.idx: float(i.amount) if i.amount is not None else 0.0
                        for i in await budget_items(session, budget_id=closure.id, tenant_id=tenant_id)}
    return {idx: round(closure_amts.get(idx, 0.0) - gfc_amts.get(idx, 0.0), 2)
            for idx in range(1, len(BUDGET_LABELS) + 1)}
