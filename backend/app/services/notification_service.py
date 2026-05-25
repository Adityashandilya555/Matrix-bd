"""Notification service — outbox-pattern dispatch.

The service NEVER calls an email/Slack API directly during the request path.
It inserts a row into `notification_outbox`; an out-of-process worker (or a
Supabase Edge Function listening on the table via realtime) drains it.

Call this AFTER you have committed the business write — if the outbox row is
in the same transaction as the state change, both succeed or both roll back,
so you never notify about a phantom event.

Resolver helpers below answer questions like "who supervises this site?" so
routes don't pass magic strings into `recipient_ids` anymore.
"""
from __future__ import annotations

from typing import Iterable, Literal, Sequence
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.rbac.roles import Role


NotificationChannel = Literal["email", "slack", "in_app"]


# ── Recipient resolution ──────────────────────────────────────────────────

async def recipients_for_supervisors(
    session: AsyncSession, *, tenant_id: str | UUID,
) -> list[UUID]:
    """All supervisors in the tenant."""
    stmt = select(models.User.id).where(
        models.User.tenant_id == tenant_id,
        models.User.is_active.is_(True),
        models.User.role == Role.SUPERVISOR.value,
    )
    return [r for r in (await session.execute(stmt)).scalars().all()]


async def recipients_for_legal_supervisors(
    session: AsyncSession, *, tenant_id: str | UUID,
) -> list[UUID]:
    """All legal supervisors in the tenant."""
    stmt = (
        select(models.User.id)
        .where(
            models.User.tenant_id == tenant_id,
            models.User.is_active.is_(True),
            models.User.role == Role.LEGAL_SUPERVISOR.value,
        )
    )
    return list((await session.execute(stmt)).scalars().all())


async def recipients_for_site_owner(
    session: AsyncSession, *, site: models.Site,
) -> list[UUID]:
    ids: list[UUID] = []
    if site.assigned_to:
        ids.append(site.assigned_to)
    if site.submitted_by and site.submitted_by not in ids:
        ids.append(site.submitted_by)
    return ids


# ── Outbox writer ─────────────────────────────────────────────────────────

async def enqueue(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    event: str,
    recipient_ids: Sequence[UUID | str],
    site_id: str | UUID | None = None,
    channels: Iterable[NotificationChannel] = ("in_app",),
    payload: dict | None = None,
    subject: str | None = None,
    body: str | None = None,
) -> int:
    """Write one outbox row per (recipient × channel). Returns how many rows."""
    written = 0
    for rid in recipient_ids:
        for ch in channels:
            session.add(models.NotificationOutbox(
                tenant_id=tenant_id,
                site_id=site_id,
                recipient_id=rid,
                type=event,
                channel=ch,
                status="pending",
                payload=payload,
                subject=subject,
                body=body,
            ))
            written += 1
    if written:
        await session.flush()
    return written


# Back-compat alias used by older call sites we haven't refactored yet.
send = enqueue
