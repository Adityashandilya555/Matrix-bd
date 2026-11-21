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
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.integrations import capture
from app.integrations import nso_payload as nso
from app.integrations import secrets as secret_store
from app.integrations.sender import BlockedAddressError, assert_public_host
from app.services.audit_service import write_audit_event

# Same rule as the DB check chk_integration_endpoints_https.
_HTTPS_URL = re.compile(r"^https://[^/?#\s]+")
ROTATION_OVERLAP = timedelta(hours=24)
RECENT_DELIVERIES = 20
BACKFILL_CHUNK = 50


def _require_key() -> None:
    if not secret_store.is_configured():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Integration key not configured on the server.")


async def _validate_url(url: str) -> str:
    url = url.strip()
    if not _HTTPS_URL.match(url) or len(url) > 2000:
        raise HTTPException(422, "Endpoint must be an https:// URL with a host.")
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


def _delivery_out(d: models.IntegrationDelivery, event_type: str, seq: int) -> dict[str, Any]:
    return {
        "outbox_id": str(d.outbox_id), "event_type": event_type, "seq": seq, "attempt_no": d.attempt_no,
        "http_status": d.http_status, "duration_ms": d.duration_ms, "error": d.error,
        "attempted_at": d.attempted_at,
    }


async def get_config(db: AsyncSession, tenant_id: str) -> dict[str, Any]:
    """Current settings, queue counts and recent deliveries. Never the secret."""
    endpoint = await _endpoint(db, tenant_id)
    tid = uuid.UUID(str(tenant_id))
    ob = models.IntegrationOutbox
    counts = dict((await db.execute(
        select(ob.status, func.count()).where(ob.tenant_id == tid, ob.integration == nso.INTEGRATION).group_by(ob.status)
    )).all())
    d = models.IntegrationDelivery
    recent = (await db.execute(
        select(d, ob.event_type, ob.seq).join(ob, ob.id == d.outbox_id)
        .where(d.tenant_id == tid).order_by(d.attempted_at.desc()).limit(RECENT_DELIVERIES)
    )).all()
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
        "recent_deliveries": [_delivery_out(row[0], row[1], row[2]) for row in recent],
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
        db.add(endpoint)
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
    old_plain = secret_store.decrypt(endpoint.secret_ciphertext, endpoint.secret_key_version)
    new_secret = secret_store.generate_secret()
    endpoint.secret_ciphertext, endpoint.secret_key_version = secret_store.encrypt(new_secret)
    endpoint.previous_secret_ciphertext, _ = secret_store.encrypt(old_plain)
    endpoint.previous_secret_expires_at = now + ROTATION_OVERLAP
    endpoint.updated_at = now
    await _audit(db, tenant_id, actor, "nso_integration_secret_rotated", "previous secret valid 24h")
    await db.flush()
    return {"secret": new_secret, "previous_valid_until": endpoint.previous_secret_expires_at}


async def _require_enabled(db: AsyncSession, tenant_id: str) -> models.IntegrationEndpoint:
    endpoint = await _endpoint(db, tenant_id)
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
    site_ids = (await db.execute(
        select(models.Site.id).where(
            models.Site.tenant_id == tid, models.Site.ca_code.isnot(None), models.Site.finance_status == "approved",
        ).order_by(models.Site.id)
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


async def list_dead(db: AsyncSession, tenant_id: str, limit: int = 100) -> list[dict[str, Any]]:
    """Dead-lettered events, newest first."""
    ob = models.IntegrationOutbox
    rows = (await db.execute(
        select(ob).where(ob.tenant_id == uuid.UUID(str(tenant_id)), ob.status == "dead")
        .order_by(ob.created_at.desc()).limit(limit)
    )).scalars().all()
    return [{
        "id": str(r.id), "seq": r.seq, "site_id": str(r.site_id), "event_type": r.event_type,
        "attempts": r.attempts, "last_http_status": r.last_http_status, "last_error": r.last_error,
        "created_at": r.created_at,
    } for r in rows]


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
