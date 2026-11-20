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
# Hard cap on one send (DNS + connect + TLS + body), well under STALE_AFTER so a
# slow receiver can't keep a claim long enough for another worker to reclaim it.
SEND_DEADLINE_SECS = 30
SNIPPET_CHARS = 500
DNS_TIMEOUT_SECS = 5

_CLAIM_SQL = text("""
UPDATE integration_outbox o
   SET status = 'sending', locked_at = now(), locked_by = :worker, attempts = o.attempts + 1
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
    """Seconds form of ``Retry-After`` only; HTTP-date form is ignored."""
    try:
        return max(0, int(value)) if value is not None else None
    except ValueError:
        return None


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
        raise BlockedAddressError(f"cannot resolve {host}") from exc
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
    ip_netloc = f"[{address}]" if ":" in address else address
    port = f":{parts.port}" if parts.port else ""
    return parts._replace(netloc=ip_netloc + port).geturl(), host + port, host


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
    except BlockedAddressError as exc:
        return Outcome(status="dead", error=f"blocked_address: {exc}")
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
            ob.attempts = max(0, ob.attempts - 1)
            ob.locked_at = None
            ob.locked_by = None
            ob.next_attempt_at = datetime.now(timezone.utc) + DISABLED_RECHECK


def _still_ours(ob: models.IntegrationOutbox) -> bool:
    return ob.status == "sending" and ob.locked_by == WORKER_ID


async def _refresh_claim(row_id: uuid.UUID) -> bool:
    """Restart the stale clock just before sending; False if we no longer own the row."""
    async with SessionLocal() as db, db.begin():
        result = await db.execute(text(
            "UPDATE integration_outbox SET locked_at = now() "
            "WHERE id = :id AND status = 'sending' AND locked_by = :w"
        ), {"id": row_id, "w": WORKER_ID})
        return bool(result.rowcount)


async def _endpoint(tenant_id: uuid.UUID) -> Optional[models.IntegrationEndpoint]:
    async with SessionLocal() as db:
        ep = models.IntegrationEndpoint
        return (await db.execute(
            select(ep).where(ep.tenant_id == tenant_id, ep.integration == INTEGRATION)
        )).scalar_one_or_none()


async def deliver(client: httpx.AsyncClient, row: Any) -> str:
    """Send one claimed row and record the result. Returns the new status."""
    if not await _refresh_claim(row.id):
        return "skipped"
    endpoint = await _endpoint(row.tenant_id)
    if endpoint is None or not endpoint.enabled:
        await _park(row.id)
        return "pending"
    try:
        secrets = endpoint_secrets(endpoint, datetime.now(timezone.utc))
    except secret_store.IntegrationKeyError as exc:
        # A key problem is ours, not the receiver's: retry with backoff, log loudly.
        log.error("integration_sender: cannot decrypt secret for tenant %s: %s", row.tenant_id, exc)
        outcome = Outcome(status=classify(None, row.attempts), error=f"key_error: {exc}")
    else:
        outcome = await post_event(client, endpoint.endpoint_url, row, secrets)
    await _record(row, outcome)
    return outcome.status


# ── Passes ─────────────────────────────────────────────────────────────────


async def reclaim_stale() -> int:
    """Rows left in ``sending`` by a dead worker become due again."""
    async with SessionLocal() as db, db.begin():
        result = await db.execute(text(
            "UPDATE integration_outbox SET status = 'failed', locked_at = NULL, locked_by = NULL, "
            "next_attempt_at = now() WHERE status = 'sending' AND locked_at < now() - make_interval(secs => :s)"
        ), {"s": STALE_AFTER.total_seconds()})
        return result.rowcount or 0


async def claim(batch: int) -> list[Any]:
    """Claim up to ``batch`` due rows for this worker (committed on return)."""
    async with SessionLocal() as db, db.begin():
        return list((await db.execute(_CLAIM_SQL, {"worker": WORKER_ID, "batch": batch})).all())


async def purge_sent(limit: int = 1000) -> int:
    """Delete one batch of sent rows past retention (deliveries cascade)."""
    async with SessionLocal() as db, db.begin():
        result = await db.execute(text(
            "DELETE FROM integration_outbox WHERE id IN ("
            " SELECT id FROM integration_outbox WHERE status = 'sent'"
            " AND sent_at < now() - make_interval(days => :d) LIMIT :n)"
        ), {"d": RETENTION.days, "n": limit})
        return result.rowcount or 0


async def run_once(client: httpx.AsyncClient, batch: int = 20) -> int:
    """One pass. Returns how many rows were claimed."""
    await reclaim_stale()
    rows = await claim(batch)
    for row in rows:
        status = await deliver(client, row)
        log.info("integration_sender: event %s seq %s → %s", row.id, row.seq, status)
    return len(rows)


async def run_forever(interval_secs: int, timeout_secs: float) -> None:
    """The background loop started from app.main's lifespan."""
    log.info("integration_sender: loop started (interval=%ds, worker=%s)", interval_secs, WORKER_ID)
    last_purge: Optional[float] = None  # None: purge on the first pass
    async with httpx.AsyncClient(timeout=timeout_secs, follow_redirects=False) as client:
        while True:
            try:
                claimed = await run_once(client)
                if last_purge is None or time.monotonic() - last_purge > 86400:
                    while await purge_sent() == 1000:
                        pass
                    last_purge = time.monotonic()
                if claimed == 20:
                    continue  # backlog: go again without sleeping
            except Exception:
                log.exception("integration_sender: pass failed")
            await asyncio.sleep(interval_secs)
