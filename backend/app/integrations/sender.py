"""Deliver queued NSO webhook events.

One pass (``run_once``):

1. Return stale claims (``sending`` for over 5 minutes: a worker died) to ``failed``.
2. Claim up to ``batch`` due rows with ``FOR UPDATE SKIP LOCKED`` in one short
   statement, so several processes (both Railway envs share one database) never
   send the same row. The claim commits before any HTTP happens.
3. For each row: sign and POST, log the attempt in ``integration_deliveries``,
   and set the row to ``sent`` / ``failed`` (with backoff) / ``dead``.
4. Once a day, delete ``sent`` rows older than 30 days. ``dead`` rows are kept.

Out-of-order delivery is fine: the receiver keeps the highest ``seq`` per site.
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging
import os
import random
import socket
import time
import uuid
from dataclasses import dataclass
from email.utils import parsedate_to_datetime
from types import SimpleNamespace
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from urllib.parse import urlsplit

import httpx
from sqlalchemy import func, select, text

from app.db import models
from app.db.session import SessionLocal
from app.integrations import secrets as secret_store
from app.integrations import signing
from app.integrations.nso_payload import INTEGRATION

log = logging.getLogger("matrix.integrations.sender")

WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"
STALE_AFTER = timedelta(minutes=5)
RETENTION = timedelta(days=30)
MAX_ATTEMPTS = 12
# Delay after attempt N fails (index N-1). Sums to about 2.15 days.
BACKOFF_SECS = (30, 120, 600, 1800, 3600, 7200, 14400, 28800, 43200, 43200, 43200)
DISABLED_RECHECK = timedelta(hours=1)
# Rows claimed per pass. Sends are sequential and each can take up to
# SEND_DEADLINE_SECS + DNS_TIMEOUT_SECS, so 5 × 35 s stays well inside
# STALE_AFTER: no claimed row can look abandoned before this worker reaches it.
CLAIM_BATCH = 5
PURGE_BATCH = 1000
# Hard cap on one send (DNS + connect + TLS + body), well under STALE_AFTER so a
# slow receiver can't keep a claim long enough for another worker to reclaim it.
SEND_DEADLINE_SECS = 30
SNIPPET_CHARS = 500
DNS_TIMEOUT_SECS = 5

_CLAIM_SQL = text("""
UPDATE integration_outbox o
   SET status = 'sending', locked_at = now(), locked_by = :worker
 WHERE o.id IN (
       SELECT id FROM integration_outbox
        WHERE status IN ('pending', 'failed') AND next_attempt_at <= now()
        ORDER BY seq
        LIMIT :batch
        FOR UPDATE SKIP LOCKED)
RETURNING o.id, o.seq, o.tenant_id, o.event_type, o.schema_version, o.payload, o.attempts, o.created_at
""")


@dataclass
class Outcome:
    """Result of one HTTP attempt."""
    status: str                      # sent | failed | dead
    http_status: Optional[int] = None
    error: Optional[str] = None
    snippet: Optional[str] = None
    duration_ms: Optional[int] = None
    retry_after: Optional[int] = None


class BlockedAddressError(Exception):
    """The endpoint resolves to an address the backend must never call."""


class ResolveError(BlockedAddressError):
    """The host didn't resolve (or DNS timed out). Usually transient: retried, not dead."""


# ── Pure helpers (unit-tested) ─────────────────────────────────────────────


def classify(http_status: Optional[int], attempts: int) -> str:
    """``sent`` for 2xx; ``dead`` for permanent 4xx or the last attempt; else ``failed``."""
    if http_status is not None and 200 <= http_status < 300:
        return "sent"
    retryable = http_status is None or http_status in (408, 429) or http_status >= 500
    if not retryable or attempts >= MAX_ATTEMPTS:
        return "dead"
    return "failed"


def backoff(attempts: int, retry_after: Optional[int] = None) -> timedelta:
    """Delay before the next attempt, with ±10% jitter; ``Retry-After`` wins if longer."""
    base = BACKOFF_SECS[min(attempts, len(BACKOFF_SECS)) - 1]
    delay = base * random.uniform(0.9, 1.1)  # noqa: S311 # nosec B311 — jitter, not security
    if retry_after:
        delay = max(delay, min(retry_after, BACKOFF_SECS[-1]))
    return timedelta(seconds=delay)


def parse_retry_after(value: Optional[str]) -> Optional[int]:
    """``Retry-After`` as seconds from now: delta-seconds or an HTTP-date."""
    if value is None:
        return None
    try:
        return max(0, int(value))
    except ValueError:
        pass
    try:
        when = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return max(0, int((when - datetime.now(timezone.utc)).total_seconds()))


def is_blocked_ip(addr: str) -> bool:
    """Anything not globally routable: private, loopback, link-local (incl. cloud
    metadata), CGNAT 100.64/10 (Railway's internal range), benchmarking,
    reserved, unspecified; plus multicast. IPv4-mapped IPv6 is unwrapped first."""
    ip = ipaddress.ip_address(addr)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return not ip.is_global or ip.is_multicast


async def resolve_public_address(url: str) -> str:
    """Resolve the URL's host once and return an address it is safe to connect to.

    Every resolved address must be public. The caller connects to the returned
    address (see ``post_event``), so a second DNS answer can't swap in an
    internal one between this check and the request (DNS rebinding).
    """
    host = urlsplit(url).hostname
    if not host:
        raise BlockedAddressError("endpoint URL has no host")
    try:
        infos = await asyncio.wait_for(
            asyncio.get_running_loop().getaddrinfo(host, None, type=socket.SOCK_STREAM), DNS_TIMEOUT_SECS,
        )
    except (socket.gaierror, asyncio.TimeoutError) as exc:
        raise ResolveError(f"cannot resolve {host}") from exc
    addrs = [info[4][0] for info in infos]
    if not addrs or any(is_blocked_ip(a) for a in addrs):
        raise BlockedAddressError(f"{host} resolves to a non-public address")
    return addrs[0]


async def assert_public_host(url: str) -> None:
    """Refuse URLs whose host is unresolvable or internal (used when saving)."""
    await resolve_public_address(url)


def pinned_request(url: str, address: str) -> tuple[str, str, str]:
    """``(url_with_ip, host_header, sni_hostname)`` for connecting to ``address``
    while still sending the right Host header and verifying the certificate
    against the real hostname."""
    parts = urlsplit(url)
    host = parts.hostname or ""
    port = f":{parts.port}" if parts.port else ""
    bracket = lambda h: f"[{h}]" if ":" in h else h  # noqa: E731  IPv6 literals
    return parts._replace(netloc=bracket(address) + port).geturl(), bracket(host) + port, host


def envelope(row: Any) -> dict[str, Any]:
    """Event metadata from the outbox row + the stored snapshot."""
    created: datetime = row.created_at
    return {
        "event_id": str(row.id),
        "event_type": row.event_type,
        "schema_version": row.schema_version,
        "seq": row.seq,
        "occurred_at": created.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        **row.payload,
    }


def endpoint_secrets(endpoint: models.IntegrationEndpoint, now: datetime) -> list[str]:
    """Current secret, plus the previous one while its rotation window is open."""
    out = [secret_store.decrypt(endpoint.secret_ciphertext, endpoint.secret_key_version)]
    if endpoint.previous_secret_ciphertext and endpoint.previous_secret_expires_at and endpoint.previous_secret_expires_at > now:
        out.append(secret_store.decrypt(endpoint.previous_secret_ciphertext, endpoint.secret_key_version))
    return out


# ── Delivery ───────────────────────────────────────────────────────────────


async def post_event(client: httpx.AsyncClient, url: str, row: Any, secrets: list[str]) -> Outcome:
    """Sign and POST one event; never raises for network or HTTP errors."""
    body = signing.canonical_body(envelope(row))
    headers = signing.build_headers(
        event_id=str(row.id), event_type=row.event_type, timestamp=int(time.time()), body=body, secrets=secrets,
    )
    started = time.monotonic()
    try:
        address = await resolve_public_address(url)
        pinned_url, headers["Host"], sni = pinned_request(url, address)
        resp = await asyncio.wait_for(
            client.post(pinned_url, content=body, headers=headers, extensions={"sni_hostname": sni}),
            SEND_DEADLINE_SECS,
        )
    except ResolveError as exc:
        return Outcome(status=classify(None, row.attempts), error=f"dns: {exc}")
    except BlockedAddressError as exc:
        return Outcome(status="dead", error=f"blocked_address: {exc}")
    except (ValueError, httpx.InvalidURL) as exc:
        # e.g. a port out of range: retrying can't fix the URL.
        return Outcome(status="dead", error=f"invalid_url: {exc}")
    except asyncio.TimeoutError:
        return Outcome(status=classify(None, row.attempts), error="deadline exceeded",
                       duration_ms=int((time.monotonic() - started) * 1000))
    except httpx.HTTPError as exc:
        return Outcome(status=classify(None, row.attempts), error=f"{type(exc).__name__}: {exc}"[:SNIPPET_CHARS],
                       duration_ms=int((time.monotonic() - started) * 1000))
    return Outcome(
        status=classify(resp.status_code, row.attempts),
        http_status=resp.status_code,
        snippet=resp.text[:SNIPPET_CHARS],
        duration_ms=int((time.monotonic() - started) * 1000),
        retry_after=parse_retry_after(resp.headers.get("retry-after")) if resp.status_code in (429, 503) else None,
    )


async def _record(row: Any, outcome: Outcome) -> None:
    async with SessionLocal() as db, db.begin():
        ob = await db.get(models.IntegrationOutbox, row.id, with_for_update=True)
        if ob is None:  # purged meanwhile
            return
        # Numbered from the log, not from ob.attempts: a replay resets attempts
        # to 0 but the earlier delivery rows stay.
        d = models.IntegrationDelivery
        attempt_no = (await db.execute(
            select(func.coalesce(func.max(d.attempt_no), 0) + 1).where(d.outbox_id == row.id)
        )).scalar_one()
        db.add(models.IntegrationDelivery(
            outbox_id=row.id, tenant_id=row.tenant_id, attempt_no=attempt_no,
            http_status=outcome.http_status, duration_ms=outcome.duration_ms,
            error=outcome.error, response_snippet=outcome.snippet,
        ))
        if not _still_ours(ob):
            # Reclaimed by another worker while this send was in flight: log the
            # attempt, but leave the row to its current owner.
            log.warning("integration_sender: lost claim on %s; result logged only", row.id)
            return
        now = datetime.now(timezone.utc)
        ob.status = outcome.status
        ob.locked_at = None
        ob.locked_by = None
        ob.last_http_status = outcome.http_status
        ob.last_error = outcome.error
        if outcome.status == "sent":
            ob.sent_at = now
        elif outcome.status == "failed":
            ob.next_attempt_at = now + backoff(row.attempts, outcome.retry_after)


async def _park(row_id: uuid.UUID) -> None:
    """Workspace switched off after queueing: put the row back, uncounted, for an hour."""
    async with SessionLocal() as db, db.begin():
        ob = await db.get(models.IntegrationOutbox, row_id, with_for_update=True)
        if ob is not None and _still_ours(ob):
            ob.status = "pending"
            ob.locked_at = None
            ob.locked_by = None
            ob.next_attempt_at = datetime.now(timezone.utc) + DISABLED_RECHECK


def _still_ours(ob: models.IntegrationOutbox) -> bool:
    return ob.status == "sending" and ob.locked_by == WORKER_ID


async def _refresh_claim(row_id: uuid.UUID) -> Optional[int]:
    """Start an attempt: restart the stale clock and count it.

    Returns the new attempt count, or None if this worker no longer owns the
    row. Attempts are counted here, when a send really starts, not at claim
    time, so a row reclaimed before it was reached isn't charged an attempt.
    """
    async with SessionLocal() as db, db.begin():
        return (await db.execute(text(
            "UPDATE integration_outbox SET locked_at = now(), attempts = attempts + 1 "
            "WHERE id = :id AND status = 'sending' AND locked_by = :w RETURNING attempts"
        ), {"id": row_id, "w": WORKER_ID})).scalar_one_or_none()


async def _endpoint(tenant_id: uuid.UUID) -> Optional[models.IntegrationEndpoint]:
    async with SessionLocal() as db:
        ep = models.IntegrationEndpoint
        return (await db.execute(
            select(ep).where(ep.tenant_id == tenant_id, ep.integration == INTEGRATION)
        )).scalar_one_or_none()


async def deliver(client: httpx.AsyncClient, row: Any) -> str:
    """Send one claimed row and record the result. Returns the new status."""
    endpoint = await _endpoint(row.tenant_id)
    if endpoint is None or not endpoint.enabled:
        await _park(row.id)
        return "pending"
    try:
        secrets = endpoint_secrets(endpoint, datetime.now(timezone.utc))
    except secret_store.IntegrationKeyError as exc:
        # Our problem, not the receiver's — e.g. another environment with a
        # different INTEGRATION_SECRET_KEY claimed it. Put it back uncounted.
        log.error("integration_sender: cannot decrypt secret for tenant %s: %s", row.tenant_id, exc)
        await _park(row.id)
        return "pending"
    attempts = await _refresh_claim(row.id)
    if attempts is None:
        return "skipped"
    row.attempts = attempts
    outcome = await post_event(client, endpoint.endpoint_url, row, secrets)
    await _record(row, outcome)
    return outcome.status


# ── Passes ─────────────────────────────────────────────────────────────────


async def reclaim_stale() -> int:
    """Rows left in ``sending`` by a dead worker become due again."""
    async with SessionLocal() as db, db.begin():
        result = await db.execute(text(
            "UPDATE integration_outbox SET locked_at = NULL, locked_by = NULL, next_attempt_at = now(), "
            "status = CASE WHEN attempts >= :max THEN 'dead' ELSE 'failed' END "
            "WHERE status = 'sending' AND locked_at < now() - make_interval(secs => :s)"
        ), {"s": STALE_AFTER.total_seconds(), "max": MAX_ATTEMPTS})
        return result.rowcount or 0


async def claim(batch: int) -> list[SimpleNamespace]:
    """Claim up to ``batch`` due rows for this worker (committed on return).

    Plain mutable objects, so ``deliver`` can record the attempt count on them.
    """
    async with SessionLocal() as db, db.begin():
        result = await db.execute(_CLAIM_SQL, {"worker": WORKER_ID, "batch": batch})
        return [SimpleNamespace(**dict(m)) for m in result.mappings()]


async def purge_sent(limit: int = PURGE_BATCH) -> int:
    """Delete one batch of sent rows past retention (deliveries cascade).

    The newest live row per site is always kept: capture compares against it
    to skip duplicates and to know whether NSO has the site (lost-eligibility
    update, tombstones). The oldest row per site is kept too, so the admin's
    per-site history can still say when the site was first sent.
    """
    async with SessionLocal() as db, db.begin():
        result = await db.execute(text(
            "DELETE FROM integration_outbox WHERE id IN ("
            " SELECT o.id FROM integration_outbox o WHERE o.status = 'sent'"
            " AND o.sent_at < now() - make_interval(days => :d)"
            " AND EXISTS (SELECT 1 FROM integration_outbox n WHERE n.tenant_id = o.tenant_id"
            "   AND n.integration = o.integration AND n.site_id = o.site_id"
            "   AND n.status <> 'dead' AND n.seq > o.seq)"
            " AND EXISTS (SELECT 1 FROM integration_outbox f WHERE f.tenant_id = o.tenant_id"
            "   AND f.integration = o.integration AND f.site_id = o.site_id AND f.seq < o.seq)"
            " LIMIT :n)"
        ), {"d": RETENTION.days, "n": limit})
        return result.rowcount or 0


async def purge_all_sent() -> int:
    """Purge in batches until a batch comes back short."""
    total = deleted = await purge_sent()
    while deleted == PURGE_BATCH:
        deleted = await purge_sent()
        total += deleted
    return total


async def run_once(client: httpx.AsyncClient, batch: int = CLAIM_BATCH) -> int:
    """One pass. Returns how many rows were claimed."""
    await reclaim_stale()
    rows = await claim(batch)
    for row in rows:
        try:
            status = await deliver(client, row)
        except Exception:
            # One bad row must not strand the rest of the batch; it is reclaimed
            # after STALE_AFTER and retried.
            log.exception("integration_sender: event %s failed unexpectedly", row.id)
            continue
        log.info("integration_sender: event %s seq %s → %s", row.id, row.seq, status)
    return len(rows)


async def run_forever(interval_secs: int, timeout_secs: float) -> None:
    """The background loop started from app.main's lifespan."""
    log.info("integration_sender: loop started (interval=%ds, worker=%s)", interval_secs, WORKER_ID)
    last_purge: Optional[float] = None  # None: purge on the first pass
    # No keep-alive: requests go to pinned IPs, and httpcore pools by origin
    # (scheme+IP+port), so a kept-alive TLS connection verified for one hostname
    # could be reused for another hostname on the same IP.
    limits = httpx.Limits(max_keepalive_connections=0)
    async with httpx.AsyncClient(timeout=timeout_secs, follow_redirects=False, limits=limits) as client:
        while True:
            try:
                claimed = await run_once(client)
                if last_purge is None or time.monotonic() - last_purge > 86400:
                    await purge_all_sent()
                    last_purge = time.monotonic()
                if claimed == CLAIM_BATCH:
                    continue  # backlog: go again without sleeping
            except Exception:
                log.exception("integration_sender: pass failed")
            await asyncio.sleep(interval_secs)
