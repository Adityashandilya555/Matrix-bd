"""Business-admin controls for the NSO platform webhook integration.

Settings, secret rotation, test event, backfill, and the dead-letter list. The
signing secret is returned in exactly two responses (first save, rotation) and
is otherwise only stored encrypted. Every change is audit-logged.
"""
from __future__ import annotations

import re
import uuid
from urllib.parse import urlsplit
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.integrations import capture
from app.integrations import nso_payload as nso
from app.integrations import secrets as secret_store
from app.integrations.sender import BlockedAddressError, assert_public_host, envelope
from app.services._common import display_code
from app.services.audit_service import write_audit_event

# Same rule as the DB check chk_integration_endpoints_https.
_HTTPS_URL = re.compile(r"^https://[^/?#\s]+")
ROTATION_OVERLAP = timedelta(hours=24)
BACKFILL_CHUNK = 50


def _require_key() -> None:
    if not secret_store.is_configured():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Integration key not configured on the server.")


async def _validate_url(url: str) -> str:
    url = url.strip()
    if not _HTTPS_URL.match(url) or len(url) > 2000:
        raise HTTPException(422, "Endpoint must be an https:// URL with a host.")
    try:
        urlsplit(url).port  # noqa: B018 — raises ValueError for "host:abc" or ":99999"
    except ValueError as exc:
        raise HTTPException(422, "The port in the endpoint URL isn't valid.") from exc
    if urlsplit(url).username is not None:
        # Requests are signed instead; userinfo would also land in the audit log.
        raise HTTPException(422, "Don't put a username or password in the URL; requests are signed.")
    try:
        await assert_public_host(url)
    except BlockedAddressError as exc:
        raise HTTPException(422, f"Endpoint not allowed: {exc}") from exc
    return url


async def _endpoint(db: AsyncSession, tenant_id: str, *, lock: bool = False) -> Optional[models.IntegrationEndpoint]:
    ep = models.IntegrationEndpoint
    stmt = select(ep).where(ep.tenant_id == uuid.UUID(str(tenant_id)), ep.integration == nso.INTEGRATION)
    if lock:
        stmt = stmt.with_for_update()
    return (await db.execute(stmt)).scalar_one_or_none()


async def _audit(db: AsyncSession, tenant_id: str, actor: dict, action: str, detail: str) -> None:
    await write_audit_event(
        db, tenant_id=tenant_id, site_id=None, actor_id=actor.get("sub"), actor_name=actor.get("name"),
        action=action, entity_type="integration", detail=detail,
    )


def _url_for_audit(url: str) -> str:
    """scheme://host/path only: a query string may carry a token, and the audit
    feed is readable by supervisors."""
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.hostname or ''}{f':{parts.port}' if parts.port else ''}{parts.path}"


TEST_SITE_ID = uuid.UUID(int=0)


def _site_ref(site_id: uuid.UUID, payload: Optional[dict], name: Optional[str], code: Optional[str]) -> Optional[dict]:
    """Which site an event was about: its current name and code, or the name
    the event itself carried when the site is gone (site.deleted)."""
    if site_id == TEST_SITE_ID:
        return None
    sent = (payload or {}).get("site") or {}
    return {
        "id": str(site_id),
        "name": name or sent.get("name"),
        "code": code or sent.get("cafe_code"),
        "deleted": name is None,
    }


def _site_cols():
    """Site name and display code: the CA code once set, else the generated code
    (the same rule the rest of the app uses)."""
    s = models.Site
    return s.name.label("site_name"), func.coalesce(s.ca_code, s.code).label("site_code")


def _site_join(stmt):
    ob = models.IntegrationOutbox
    s = models.Site
    return stmt.outerjoin(s, (s.id == ob.site_id) & (s.tenant_id == ob.tenant_id))


async def get_config(db: AsyncSession, tenant_id: str) -> dict[str, Any]:
    """Current settings and queue counts. Never the secret.

    Per-site deliveries are served by ``list_sites`` / ``site_history``."""
    endpoint = await _endpoint(db, tenant_id)
    tid = uuid.UUID(str(tenant_id))
    ob = models.IntegrationOutbox
    counts = dict((await db.execute(
        select(ob.status, func.count()).where(ob.tenant_id == tid, ob.integration == nso.INTEGRATION).group_by(ob.status)
    )).all())
    now = datetime.now(timezone.utc)
    return {
        "configured": endpoint is not None,
        "key_configured": secret_store.is_configured(),
        "enabled": bool(endpoint and endpoint.enabled),
        "endpoint_url": endpoint.endpoint_url if endpoint else None,
        "updated_at": endpoint.updated_at if endpoint else None,
        "rotation_in_progress": bool(
            endpoint and endpoint.previous_secret_expires_at and endpoint.previous_secret_expires_at > now
        ),
        "counts": {k: counts.get(k, 0) for k in ("pending", "sending", "sent", "failed", "dead")},
    }


async def save_config(db: AsyncSession, tenant_id: str, actor: dict, endpoint_url: str, enabled: bool) -> dict[str, Any]:
    """Create or update the endpoint. The first save returns the new secret once.

    Switching off never depends on DNS or the server key: when NSO's host is
    down is exactly when an admin needs to stop queueing.
    """
    endpoint = await _endpoint(db, tenant_id, lock=True)
    url = endpoint_url.strip()
    only_disabling = endpoint is not None and not enabled and url == endpoint.endpoint_url
    if not only_disabling:
        _require_key()
        url = await _validate_url(url)
    was_enabled = bool(endpoint and endpoint.enabled)
    now = datetime.now(timezone.utc)
    new_secret: Optional[str] = None
    if endpoint is None:
        new_secret = secret_store.generate_secret()
        ciphertext, version = secret_store.encrypt(new_secret)
        endpoint = models.IntegrationEndpoint(
            tenant_id=uuid.UUID(str(tenant_id)), integration=nso.INTEGRATION, endpoint_url=url, enabled=enabled,
            secret_ciphertext=ciphertext, secret_key_version=version, schema_version=nso.SCHEMA_VERSION,
            created_by=uuid.UUID(str(actor["sub"])) if actor.get("sub") else None,
            disabled_at=None if enabled else now,
        )
        try:
            # Two admins saving the first time at once: one wins, the other gets
            # a 409 instead of a 500 (and is never shown a secret that wasn't stored).
            async with db.begin_nested():
                db.add(endpoint)
                await db.flush()
        except IntegrityError as exc:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "The integration was just set up by someone else; reload the page.") from exc
    else:
        if endpoint.enabled and not enabled:
            endpoint.disabled_at = now
        elif enabled:
            endpoint.disabled_at = None
        endpoint.endpoint_url = url
        endpoint.enabled = enabled
        endpoint.updated_at = now
    await _audit(db, tenant_id, actor, "nso_integration_saved", f"enabled={enabled} url={_url_for_audit(url)}")
    just_enabled = enabled and not was_enabled
    if just_enabled:
        # Rows parked while the workspace was off wait an hour; send them now.
        ob = models.IntegrationOutbox
        await db.execute(
            update(ob).where(ob.tenant_id == endpoint.tenant_id, ob.status.in_(("pending", "failed")))
            .values(next_attempt_at=func.now())
        )
    await db.flush()
    # Changes made while switched off were never queued; the UI prompts for a
    # backfill when this is true (a deliberate click, not an automatic flood).
    return {"enabled": enabled, "endpoint_url": url, "secret": new_secret,
            "just_enabled": just_enabled}


async def rotate_secret(db: AsyncSession, tenant_id: str, actor: dict) -> dict[str, Any]:
    """New secret (returned once); the old one stays valid for 24 hours.

    Both are re-encrypted with the newest key so one ``secret_key_version``
    describes both columns.
    """
    _require_key()
    endpoint = await _endpoint(db, tenant_id, lock=True)
    if endpoint is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Set up the integration first.")
    now = datetime.now(timezone.utc)
    if endpoint.previous_secret_expires_at and endpoint.previous_secret_expires_at > now:
        # A second rotation would silently drop the secret NSO may still be using.
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "A rotation is already in progress; try again after it finishes.")
    try:
        old_plain: Optional[str] = secret_store.decrypt(endpoint.secret_ciphertext, endpoint.secret_key_version)
    except secret_store.IntegrationKeyError:
        # The key that encrypted the old secret is gone: issue a new secret with
        # no overlap window rather than failing the only way to recover.
        old_plain = None
    new_secret = secret_store.generate_secret()
    endpoint.secret_ciphertext, endpoint.secret_key_version = secret_store.encrypt(new_secret)
    endpoint.previous_secret_ciphertext = secret_store.encrypt(old_plain)[0] if old_plain else None
    endpoint.previous_secret_expires_at = now + ROTATION_OVERLAP if old_plain else None
    endpoint.updated_at = now
    await _audit(db, tenant_id, actor, "nso_integration_secret_rotated", "previous secret valid 24h")
    await db.flush()
    return {"secret": new_secret, "previous_valid_until": endpoint.previous_secret_expires_at}


async def _require_enabled(db: AsyncSession, tenant_id: str, *, lock: bool = False) -> models.IntegrationEndpoint:
    # lock=True holds the endpoint row (as save_config does) until commit, so a
    # concurrent switch-off can't land between this check and the queued event.
    endpoint = await _endpoint(db, tenant_id, lock=lock)
    if endpoint is None or not endpoint.enabled:
        raise HTTPException(status.HTTP_409_CONFLICT, "Switch the integration on first.")
    return endpoint


async def send_test(db: AsyncSession, tenant_id: str, actor: dict) -> dict[str, Any]:
    """Queue a ``site.test`` event; the sender picks it up within seconds."""
    await _require_enabled(db, tenant_id)
    tid = uuid.UUID(str(tenant_id))
    name = (await db.execute(select(models.Tenant.name).where(models.Tenant.id == tid))).scalar_one()
    payload = nso.sample_payload(tid, name)
    await db.run_sync(lambda s: capture.enqueue(s, tid, uuid.UUID(int=0), nso.EVENT_TEST, payload))
    await _audit(db, tenant_id, actor, "nso_integration_test_sent", "site.test queued")
    return {"queued": True}


async def backfill(db: AsyncSession, tenant_id: str, actor: dict) -> dict[str, Any]:
    """Queue a snapshot of every eligible site (skips ones already up to date)."""
    await _require_enabled(db, tenant_id)
    tid = uuid.UUID(str(tenant_id))
    # nso.is_eligible as a query, so a big workspace doesn't lock and snapshot
    # every never-eligible site. Plus sites NSO already has (a non-dead event):
    # one that left the pipeline while sending was off still needs its final
    # update. queue_site_snapshot skips it if NSO already has that final state.
    ob = models.IntegrationOutbox
    known_to_nso = select(ob.site_id).where(
        ob.tenant_id == tid, ob.integration == nso.INTEGRATION, ob.status != "dead",
    )
    site_ids = (await db.execute(
        select(models.Site.id)
        .where(models.Site.tenant_id == tid, or_(nso.eligible_clause(), models.Site.id.in_(known_to_nso)))
        .order_by(models.Site.id)
    )).scalars().all()
    # Audit first, so it commits with the first chunk even if a later one fails.
    await _audit(db, tenant_id, actor, "nso_integration_backfill", f"eligible={len(site_ids)}")

    # Committed in chunks so each site's lock is held briefly, not for the whole
    # backfill: a large workspace must not block everyone's edits meanwhile.
    queued = 0
    for start in range(0, len(site_ids), BACKFILL_CHUNK):
        chunk = site_ids[start:start + BACKFILL_CHUNK]
        queued += await db.run_sync(lambda s, c=chunk: sum(capture.queue_site_snapshot(s, sid) for sid in c))
        await db.commit()
    return {"eligible": len(site_ids), "queued": queued}


OUT_OF_PIPELINE = frozenset({"archived", "rejected", "legal_rejected"})


def _not_shareable_reason(site: models.Site) -> Optional[str]:
    """Why NSO may not get this site yet, or None when it may (nso.is_eligible)."""
    if nso.is_eligible({"cafe_code": nso.shared_cafe_code(site.ca_code, site.finance_status), "status": site.status}):
        return None
    if site.status in OUT_OF_PIPELINE:
        return "This site is archived or rejected, so it isn't shared with NSO."
    return "This site hasn't been sent to Legal yet, so it isn't shared with NSO."


async def _last_event(db: AsyncSession, tid: uuid.UUID, site_id: uuid.UUID) -> Optional[dict[str, Any]]:
    ob = models.IntegrationOutbox
    r = (await db.execute(
        select(ob).where(ob.tenant_id == tid, ob.integration == nso.INTEGRATION, ob.site_id == site_id)
        .order_by(ob.seq.desc()).limit(1)
    )).scalar_one_or_none()
    if r is None:
        return None
    return {"id": str(r.id), "seq": r.seq, "status": r.status, "last_http_status": r.last_http_status,
            "created_at": r.created_at, "sent_at": r.sent_at}


async def lookup_site(db: AsyncSession, tenant_id: str, ca_code: str) -> dict[str, Any]:
    """Find a site in this workspace by CA code and say whether NSO may get it."""
    code = ca_code.strip()
    if not code:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Enter a CA code.")
    tid = uuid.UUID(str(tenant_id))
    s = models.Site
    site = (await db.execute(
        select(s).where(s.tenant_id == tid, func.upper(s.ca_code) == code.upper())
    )).scalar_one_or_none()
    if site is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No site in this workspace has CA code {code}.")
    reason = _not_shareable_reason(site)
    return {
        "site": {"id": str(site.id), "name": site.name, "city": site.city, "code": site.ca_code},
        "shareable": reason is None, "reason": reason,
        "last_event": await _last_event(db, tid, site.id),
    }


IN_FLIGHT = frozenset({"pending", "sending", "failed"})


async def resend_site(db: AsyncSession, tenant_id: str, actor: dict, site_id: uuid.UUID) -> dict[str, Any]:
    """Queue a fresh snapshot of one site's current data, even if NSO already has it.

    A new event (new id and seq), not a replay: NSO skips event ids it has seen
    and events older than the newest it holds, so a replay of an old event could
    be ignored again or carry stale data.
    """
    await _require_enabled(db, tenant_id, lock=True)
    tid = uuid.UUID(str(tenant_id))
    site = (await db.execute(
        select(models.Site).where(models.Site.id == site_id, models.Site.tenant_id == tid)
    )).scalar_one_or_none()
    if site is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No site with that id in this workspace.")
    reason = _not_shareable_reason(site)
    if reason:
        raise HTTPException(status.HTTP_409_CONFLICT, reason)
    last = await _last_event(db, tid, site_id)
    if last and last["status"] in IN_FLIGHT:
        # Another forced event would only queue behind it: NSO keeps the highest seq.
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"An update for this site is already on its way (#{last['seq']}). "
                            "Wait for it to finish, then send again if needed.")
    name, code = site.name, site.ca_code
    queued = await db.run_sync(lambda sess: capture.queue_site_snapshot(sess, site_id, force=True))
    if not queued:
        raise HTTPException(status.HTTP_409_CONFLICT, "This site could not be queued. Refresh and try again.")
    await _audit(db, tenant_id, actor, "nso_integration_resend", f"site_id={site_id} ca_code={code}")
    return {"queued": True, "site": {"id": str(site_id), "name": name, "code": code}}


async def list_dead(db: AsyncSession, tenant_id: str, limit: int = 100) -> list[dict[str, Any]]:
    """Dead-lettered events, newest first, with the site and NSO's last reply."""
    ob = models.IntegrationOutbox
    d = models.IntegrationDelivery
    last_reply = (
        select(d.response_snippet).where(d.outbox_id == ob.id)
        .order_by(d.attempted_at.desc()).limit(1).correlate(ob).scalar_subquery()
    )
    rows = (await db.execute(
        _site_join(select(ob, last_reply.label("reply"), *_site_cols()))
        .where(ob.tenant_id == uuid.UUID(str(tenant_id)), ob.status == "dead")
        .order_by(ob.created_at.desc()).limit(limit)
    )).all()
    return [{
        "id": str(r.id), "seq": r.seq, "site_id": str(r.site_id), "event_type": r.event_type,
        "attempts": r.attempts, "last_http_status": r.last_http_status, "last_error": r.last_error,
        "response_snippet": row.reply, "created_at": r.created_at,
        "site": _site_ref(r.site_id, r.payload, row.site_name, row.site_code),
    } for row in rows for r in (row.IntegrationOutbox,)]


def _like(term: str) -> str:
    return "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


async def get_event(db: AsyncSession, tenant_id: str, outbox_id: uuid.UUID) -> dict[str, Any]:
    """One event: the exact JSON body Matrix sends for it, and every attempt with NSO's reply."""
    ob = models.IntegrationOutbox
    d = models.IntegrationDelivery
    tid = uuid.UUID(str(tenant_id))
    row = (await db.execute(
        _site_join(select(ob, *_site_cols())).where(ob.id == outbox_id, ob.tenant_id == tid)
    )).one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No event with that id.")
    r = row.IntegrationOutbox
    attempts = (await db.execute(
        select(d).where(d.outbox_id == r.id, d.tenant_id == tid).order_by(d.attempt_no.desc())
    )).scalars().all()
    return {
        "id": str(r.id), "seq": r.seq, "event_type": r.event_type, "status": r.status,
        "created_at": r.created_at, "sent_at": r.sent_at,
        "site": _site_ref(r.site_id, r.payload, row.site_name, row.site_code),
        "body": envelope(r),
        "attempts": [{
            "attempt_no": a.attempt_no, "http_status": a.http_status, "duration_ms": a.duration_ms,
            "error": a.error, "response_snippet": a.response_snippet, "attempted_at": a.attempted_at,
        } for a in attempts],
    }


async def replay(db: AsyncSession, tenant_id: str, actor: dict, outbox_id: uuid.UUID) -> dict[str, Any]:
    """Put one dead event back in the queue with a fresh attempt count."""
    ob = models.IntegrationOutbox
    result = await db.execute(
        update(ob).where(ob.id == outbox_id, ob.tenant_id == uuid.UUID(str(tenant_id)), ob.status == "dead")
        .values(status="pending", attempts=0, next_attempt_at=func.now(), last_error=None)
    )
    if not result.rowcount:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No dead event with that id.")
    await _audit(db, tenant_id, actor, "nso_integration_replay", f"outbox_id={outbox_id}")
    return {"replayed": True}


# ── One row per site, with its history ───────────────────────────────────────

SITES_PAGE_SIZE = 25
HISTORY_LIMIT = 100
# Outbox status → what the admin sees for the site's latest event.
_STATE = {"sent": "up_to_date", "pending": "sending", "sending": "sending", "failed": "retrying", "dead": "gave_up"}


def _site_match(pattern: str, sent_site):
    s = models.Site
    return (s.name.ilike(pattern) | s.ca_code.ilike(pattern) | s.code.ilike(pattern)
            | sent_site["name"].astext.ilike(pattern) | sent_site["cafe_code"].astext.ilike(pattern))


async def list_sites(db: AsyncSession, tenant_id: str, q: str = "", page: int = 1) -> dict[str, Any]:
    """One row per site NSO has been sent (test events share one row), latest activity first.

    Each row: when the site was first sent, its latest event, how many events
    it has had, and the state of the latest one (up to date, sending, retrying,
    gave up), so a long trail of updates reads as one line per site.
    """
    ob = models.IntegrationOutbox
    tid = uuid.UUID(str(tenant_id))
    per_site = {"partition_by": ob.site_id}
    ranked = (
        select(
            ob.id, ob.site_id, ob.seq, ob.event_type, ob.status, ob.attempts, ob.last_http_status,
            ob.last_error, ob.next_attempt_at, ob.created_at, ob.sent_at, ob.payload["site"].label("sent_site"),
            func.row_number().over(**per_site, order_by=ob.seq.desc()).label("rn"),
            func.count().over(**per_site).label("events"),
            func.min(ob.created_at).over(**per_site).label("first_at"),
            func.min(ob.sent_at).over(**per_site).label("first_sent_at"),
        )
        .where(ob.tenant_id == tid, ob.integration == nso.INTEGRATION)
        .subquery()
    )
    s = models.Site
    stmt = (
        select(ranked, *_site_cols())
        .outerjoin(s, (s.id == ranked.c.site_id) & (s.tenant_id == tid))
        .where(ranked.c.rn == 1)
    )
    term = q.strip()[:100]
    if term:
        stmt = stmt.where(ranked.c.site_id != TEST_SITE_ID, _site_match(_like(term), ranked.c.sent_site))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    page = max(page, 1)
    rows = (await db.execute(
        stmt.order_by(ranked.c.created_at.desc(), ranked.c.seq.desc())
        .limit(SITES_PAGE_SIZE).offset((page - 1) * SITES_PAGE_SIZE)
    )).all()
    return {
        "total": total, "page": page, "page_size": SITES_PAGE_SIZE,
        "sites": [{
            "site_id": str(r.site_id),
            "site": _site_ref(r.site_id, {"site": r.sent_site}, r.site_name, r.site_code),
            "events": r.events, "first_at": r.first_at, "first_sent_at": r.first_sent_at,
            "state": _STATE.get(r.status, r.status),
            "latest": {
                "id": str(r.id), "seq": r.seq, "event_type": r.event_type, "status": r.status,
                "attempts": r.attempts, "last_http_status": r.last_http_status, "last_error": r.last_error,
                "next_attempt_at": r.next_attempt_at, "created_at": r.created_at, "sent_at": r.sent_at,
            },
        } for r in rows],
    }


def _flatten(value: Any, prefix: str = "") -> dict[str, Any]:
    if not isinstance(value, dict):
        return {prefix.rstrip("."): value}
    out: dict[str, Any] = {}
    for key, inner in value.items():
        out.update(_flatten(inner, f"{prefix}{key}."))
    return out


def payload_changes(before: Optional[dict], after: Optional[dict]) -> Optional[list[dict[str, Any]]]:
    """Fields that differ between two payloads, as dotted paths (``site.status``).

    ``None`` when there is no earlier payload: the event is the site's first.
    """
    if before is None:
        return None
    old, new = _flatten(before or {}), _flatten(after or {})
    return [{"field": k, "from": old.get(k), "to": new.get(k)}
            for k in sorted(old.keys() | new.keys()) if old.get(k) != new.get(k)]


async def site_history(db: AsyncSession, tenant_id: str, site_id: uuid.UUID) -> dict[str, Any]:
    """Every event for one site (newest first): what changed since the one
    before, each attempt with NSO's reply, and whether the site can be sent now."""
    ob = models.IntegrationOutbox
    d = models.IntegrationDelivery
    tid = uuid.UUID(str(tenant_id))
    events = (await db.execute(
        select(ob).where(ob.tenant_id == tid, ob.integration == nso.INTEGRATION, ob.site_id == site_id)
        .order_by(ob.seq.desc()).limit(HISTORY_LIMIT + 1)
    )).scalars().all()
    if not events:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nothing has been sent for that site.")
    # One extra row so the oldest shown event can still say what it changed.
    shown, older = events[:HISTORY_LIMIT], events[HISTORY_LIMIT:]
    attempts: dict[uuid.UUID, list[dict[str, Any]]] = {}
    for a in (await db.execute(
        select(d).where(d.tenant_id == tid, d.outbox_id.in_([e.id for e in shown])).order_by(d.attempt_no.desc())
    )).scalars():
        attempts.setdefault(a.outbox_id, []).append({
            "attempt_no": a.attempt_no, "http_status": a.http_status, "duration_ms": a.duration_ms,
            "error": a.error, "response_snippet": a.response_snippet, "attempted_at": a.attempted_at,
        })
    site = (await db.execute(
        select(models.Site).where(models.Site.id == site_id, models.Site.tenant_id == tid)
    )).scalar_one_or_none()
    chain = shown + older
    latest = shown[0]

    def baseline(i: int) -> Optional[models.IntegrationOutbox]:
        """The nearest older event NSO may have taken (dead events never reached it)."""
        return next((e for e in chain[i + 1:] if e.status != "dead"), None)
    return {
        "site": _site_ref(site_id, latest.payload, site.name if site else None,
                          display_code(site) if site else None),
        "state": _STATE.get(latest.status, latest.status),
        "reason": _not_shareable_reason(site) if site else None,
        "truncated": bool(older),
        "events": [{
            "id": str(e.id), "seq": e.seq, "event_type": e.event_type, "status": e.status,
            "attempts": e.attempts, "last_http_status": e.last_http_status, "last_error": e.last_error,
            "next_attempt_at": e.next_attempt_at, "created_at": e.created_at, "sent_at": e.sent_at,
            "changes": (None if e.event_type != nso.EVENT_UPDATED
                        else payload_changes(prev.payload if prev else None, e.payload)),
            # The first event NSO could have taken: not dead, nothing older that
            # wasn't, and the history isn't cut off at HISTORY_LIMIT.
            "first": e.status != "dead" and prev is None and not older,
            "tries": attempts.get(e.id, []),
        } for i, e in enumerate(shown) for prev in (baseline(i),)],
    }
