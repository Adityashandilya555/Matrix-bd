"""Notification service — outbox-pattern dispatch + in-process email drain.

Write path (enqueue):
  Inserts one `notification_outbox` row per (recipient × channel).  Crucially
  it also populates `recipient_email` by looking up the user row — without
  this the email rows are un-sendable even if a drain exists (#112).

  Call enqueue() AFTER you have committed the business write — if the outbox
  row is in the same transaction as the state change, both succeed or both
  roll back, so you never notify about a phantom event.

Drain path (drain_pending_emails):
  Fetches up to `batch_size` pending email rows and dispatches each via the
  Resend API (https://resend.com).  Called from the background loop wired in
  main.py lifespan when RESEND_API_KEY is configured.  Each row's `attempts`
  counter is incremented; rows with attempts >= 3 are skipped (permanent
  failure after 3 tries).

Resolver helpers answer "who supervises this site?" so routes don't pass
magic strings into `recipient_ids` anymore.
"""
from __future__ import annotations

import logging
from typing import Iterable, Literal, Sequence
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.rbac.roles import Role

log = logging.getLogger("matrix.notifications")


NotificationChannel = Literal["email", "slack", "in_app"]


# ── Recipient resolution ──────────────────────────────────────────────────

async def recipients_for_supervisors(
    session: AsyncSession, *, tenant_id: str | UUID,
) -> list[UUID]:
    """All supervisors in the tenant (3-role model: role == 'supervisor')."""
    stmt = select(models.User.id).where(
        models.User.tenant_id == tenant_id,
        models.User.is_active.is_(True),
        models.User.role == Role.SUPERVISOR.value,
    )
    return list((await session.execute(stmt)).scalars().all())


async def recipients_for_legal_supervisors(
    session: AsyncSession, *, tenant_id: str | UUID,
) -> list[UUID]:
    """Supervisors whose module membership is 'legal' in this tenant.

    Queries user_module_memberships (the authoritative membership table) rather
    than users.role, because in the 3-role model all legal staff are simply
    role=supervisor / role=executive scoped to module='legal'.
    """
    rows = await session.execute(
        text(
            """
            SELECT u.id
              FROM user_module_memberships m
              JOIN users u ON u.id = m.user_id
             WHERE m.tenant_id  = :tenant_id
               AND m.module     = 'legal'
               AND m.role_in_module = 'supervisor'
               AND u.is_active  = true
            """
        ),
        {"tenant_id": str(tenant_id)},
    )
    return [row[0] for row in rows]


async def recipients_for_design_supervisors(
    session: AsyncSession, *, tenant_id: str | UUID,
) -> list[UUID]:
    """Supervisors whose module membership is 'design' in this tenant.

    Same membership-based resolution as recipients_for_legal_supervisors — in the
    3-role model design staff are role=supervisor / role=executive scoped to
    module='design'.
    """
    rows = await session.execute(
        text(
            """
            SELECT u.id
              FROM user_module_memberships m
              JOIN users u ON u.id = m.user_id
             WHERE m.tenant_id  = :tenant_id
               AND m.module     = 'design'
               AND m.role_in_module = 'supervisor'
               AND u.is_active  = true
            """
        ),
        {"tenant_id": str(tenant_id)},
    )
    return [row[0] for row in rows]


async def recipients_for_module_supervisors(
    session: AsyncSession, *, tenant_id: str | UUID, module: str,
) -> list[UUID]:
    """Supervisors whose module membership is `module` in this tenant.

    Generic form of recipients_for_legal/design_supervisors — used to notify the
    next module's supervisors on a cross-module hand-off (e.g. Design GFC →
    Project Excellence).
    """
    rows = await session.execute(
        text(
            """
            SELECT u.id
              FROM user_module_memberships m
              JOIN users u ON u.id = m.user_id
             WHERE m.tenant_id  = :tenant_id
               AND m.module     = :module
               AND m.role_in_module = 'supervisor'
               AND u.is_active  = true
            """
        ),
        {"tenant_id": str(tenant_id), "module": module},
    )
    return [row[0] for row in rows]


async def recipients_for_business_admins(
    session: AsyncSession, *, tenant_id: str | UUID,
) -> list[UUID]:
    """All business_admins in the tenant (role == 'business_admin').

    Used by the Design module to notify admins when a site reaches the GFC gate.
    """
    stmt = select(models.User.id).where(
        models.User.tenant_id == tenant_id,
        models.User.is_active.is_(True),
        models.User.role == Role.BUSINESS_ADMIN.value,
    )
    return list((await session.execute(stmt)).scalars().all())


async def recipients_for_site_owner(
    _session: AsyncSession, *, site: models.Site,
) -> list[UUID]:
    """Return the site's assignee and submitter as notification recipients."""
    # _session is unused (recipients are read from the in-memory site) but kept
    # in the signature for call-site uniformity with the other recipients_*
    # helpers; underscore-prefixed to mark it intentionally unused (#238).
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
    """Write one outbox row per (recipient × channel). Returns how many rows.

    For email-channel rows, recipient_email is populated by a single bulk
    lookup against the users table so the drain has a deliverable address (#112).
    """
    channels_list = list(channels)  # consume the iterator exactly once

    # Bulk-fetch emails for all recipients when at least one email row will be written.
    email_map: dict[str, str] = {}
    if "email" in channels_list and recipient_ids:
        res = await session.execute(
            select(models.User.id, models.User.email).where(
                models.User.id.in_([str(r) for r in recipient_ids])
            )
        )
        email_map = {str(row[0]): row[1] for row in res}

    written = 0
    for rid in recipient_ids:
        for ch in channels_list:
            session.add(models.NotificationOutbox(
                tenant_id=tenant_id,
                site_id=site_id,
                recipient_id=rid,
                recipient_email=email_map.get(str(rid)) if ch == "email" else None,
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


# ── In-process email drain (Resend API) ──────────────────────────────────────

async def drain_pending_emails(*, resend_api_key: str, batch_size: int = 20) -> int:
    """Fetch up to `batch_size` pending email rows and dispatch via Resend.

    • Only rows with `recipient_email IS NOT NULL` and `attempts < 3` are
      considered — permanently-failed rows are left for manual inspection.
    • Each row's `attempts` counter is incremented regardless of outcome.
    • Rows already picked up by a concurrent drain run are skipped because
      the UPDATE uses `WHERE status = 'pending'` as an optimistic guard.

    Returns the count of rows dispatched (sent + failed).
    """
    import httpx

    from app.core.config import settings as _cfg
    from app.db.session import SessionLocal

    # ── 1. Fetch candidates (no long-held lock during HTTP calls) ─────────────
    async with SessionLocal() as session:
        result = await session.execute(
            text("""
                SELECT id, recipient_email, subject, body, type
                  FROM notification_outbox
                 WHERE channel = 'email'
                   AND status  = 'pending'
                   AND attempts < 3
                   AND recipient_email IS NOT NULL
                 ORDER BY created_at
                 LIMIT :n
            """),
            {"n": batch_size},
        )
        rows = result.mappings().all()

    if not rows:
        return 0

    # ── 2. Dispatch each row, collecting outcomes (no DB work during HTTP) ────
    outcomes: list[dict] = []
    async with httpx.AsyncClient(timeout=15.0) as client:
        for row in rows:
            try:
                resp = await client.post(
                    "https://api.resend.com/emails",
                    headers={
                        "Authorization": f"Bearer {resend_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "from":    _cfg.resend_from_email,
                        "to":      [row["recipient_email"]],
                        "subject": row["subject"] or row["type"].replace("_", " ").title(),
                        "html":    row["body"] or f"<p>Event: {row['type']}</p>",
                    },
                )
                new_status = "sent" if resp.status_code in (200, 201) else "failed"
                reason = None if new_status == "sent" else resp.text[:200]
            except Exception as exc:  # network error, timeout, etc.
                new_status = "failed"
                reason = str(exc)[:200]

            if new_status == "failed":
                log.warning("email_drain: failed to send row=%s reason=%s", row["id"], reason)
            outcomes.append({"status": new_status, "reason": reason, "id": str(row["id"])})

    # ── 3. Write all status updates in ONE session/transaction (#375) ─────────
    # Previously each row opened its own SessionLocal() + transaction — under
    # NullPool (pgBouncer) that is a fresh TCP connection per email, so a batch
    # of 20 cost 20 connections. One short transaction after the HTTP loop
    # costs one, and still never holds a DB connection during the slow HTTP
    # calls. The per-row `WHERE status = 'pending'` optimistic guard is kept,
    # so rows claimed by a concurrent drain are skipped exactly as before.
    # Trade-off: a process crash mid-batch now leaves the whole batch
    # 'pending' (re-sent next run) instead of just the in-flight row — an
    # acceptable at-least-once widening for a background mailer, still bounded
    # by the attempts < 3 cap.
    async with SessionLocal() as upd, upd.begin():
        for outcome in outcomes:
            await upd.execute(
                text("""
                        UPDATE notification_outbox
                           SET status        = :status,
                               failed_reason = :reason,
                               attempts      = attempts + 1,
                               sent_at       = CASE WHEN :status = 'sent'
                                                    THEN now() ELSE sent_at END
                         WHERE id = :id AND status = 'pending'
                    """),
                outcome,
            )

    return len(outcomes)
