"""Queue NSO webhook events in the same transaction as the site change.

Registered on ``MatrixSession`` (the sync session behind every ``AsyncSession``
from ``SessionLocal``), so every ORM write path is covered without each service
having to remember a call:

* ``after_flush`` notes which sites had a watched attribute change, and builds
  tombstones for deleted sites while their attributes are still readable.
* ``before_commit`` flushes, then for each noted site in an enabled workspace:
  locks the site row, builds a snapshot, skips it if identical to the last one
  queued, and inserts an ``integration_outbox`` row.

Locking the site row before inserting is what keeps ``seq`` in commit order per
site: a second transaction touching the same site waits, then builds its
snapshot from the first one's committed data, so the higher ``seq`` always
carries the newer state.

The hooks only read and insert. They never swallow errors: a bug here should
fail loudly in tests, not silently drop events.
"""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import event, insert, inspect, select
from sqlalchemy.orm import Session

from app.db import models
from app.integrations import nso_payload as nso

_TOUCHED = "nso_touched_sites"
_DELETED = "nso_deleted_sites"


def _site_id_of(obj: Any) -> uuid.UUID | None:
    return obj.id if isinstance(obj, models.Site) else getattr(obj, "site_id", None)


def _changed(obj: Any, attrs: frozenset[str], is_new: bool) -> bool:
    if is_new:
        return True
    state = inspect(obj)
    return any(state.attrs[name].history.has_changes() for name in attrs)


def _committed(obj: Any, name: str) -> Any:
    """The attribute's value as last loaded from the database (pre-change)."""
    hist = inspect(obj).attrs[name].history
    if hist.deleted:
        return hist.deleted[0]
    return getattr(obj, name)


def _after_flush(session: Session, _flush_context: Any) -> None:
    touched: set[uuid.UUID] = session.info.setdefault(_TOUCHED, set())
    deleted: dict[uuid.UUID, dict] = session.info.setdefault(_DELETED, {})
    for obj in session.new | session.dirty:
        attrs = nso.WATCHED.get(type(obj))
        if attrs and _changed(obj, attrs, obj in session.new):
            site_id = _site_id_of(obj)
            if site_id is not None:
                touched.add(site_id)
    for obj in session.deleted:
        if isinstance(obj, models.Site):
            deleted[obj.id] = {
                "tenant_id": obj.tenant_id,
                "cafe_code": _committed(obj, "ca_code"),
                "name": _committed(obj, "name"),
            }


def _enabled_tenants(session: Session, tenant_ids: set[uuid.UUID]) -> set[uuid.UUID]:
    if not tenant_ids:
        return set()
    ep = models.IntegrationEndpoint
    return set(session.execute(
        select(ep.tenant_id).where(
            ep.tenant_id.in_(tenant_ids), ep.integration == nso.INTEGRATION, ep.enabled.is_(True),
        )
    ).scalars())


def _last_payload(session: Session, tenant_id: uuid.UUID, site_id: uuid.UUID) -> dict | None:
    ob = models.IntegrationOutbox
    return session.execute(
        select(ob.payload)
        .where(ob.tenant_id == tenant_id, ob.integration == nso.INTEGRATION, ob.site_id == site_id)
        .order_by(ob.seq.desc())
        .limit(1)
    ).scalar_one_or_none()


def enqueue(session: Session, tenant_id: uuid.UUID, site_id: uuid.UUID, event_type: str, payload: dict) -> None:
    """Insert one outbox row (caller has already checked enablement)."""
    session.execute(insert(models.IntegrationOutbox).values(
        tenant_id=tenant_id,
        integration=nso.INTEGRATION,
        site_id=site_id,
        event_type=event_type,
        schema_version=nso.SCHEMA_VERSION,
        payload=payload,
    ))


def queue_site_snapshot(session: Session, site_id: uuid.UUID, *, force: bool = False) -> bool:
    """Lock the site, build its snapshot and queue it if NSO should get it.

    Queued when the site is eligible, or when it was shared before and has just
    stopped being eligible (NSO gets one last update showing why). Skipped when
    identical to the last queued snapshot unless ``force``. Returns whether a
    row was queued. The caller has checked the workspace is enabled.
    """
    # Serialise per site; see the module docstring. FOR NO KEY UPDATE, not FOR
    # UPDATE: it is the lock an ordinary UPDATE of the site already holds, so it
    # never needs upgrading, and it doesn't conflict with the KEY SHARE lock a
    # concurrent insert into a child table (nso_reviews, site_licensing...) takes
    # through its foreign key. FOR UPDATE deadlocked in exactly that case.
    locked = session.execute(
        select(models.Site.tenant_id).where(models.Site.id == site_id).with_for_update(key_share=True)
    ).scalar_one_or_none()
    if locked is None:
        return False
    snapshot = nso.build_snapshot(session, site_id)
    if snapshot is None:
        return False
    previous = _last_payload(session, locked, site_id)
    was_shared = bool(previous and previous.get("site", {}).get("cafe_code"))
    if not nso.is_eligible(snapshot["site"]["cafe_code"]) and not was_shared:
        return False
    if previous == snapshot and not force:
        return False
    enqueue(session, locked, site_id, nso.EVENT_UPDATED, snapshot)
    return True


def _before_commit(session: Session) -> None:
    session.flush()  # run after_flush for anything still pending
    touched: set[uuid.UUID] = session.info.pop(_TOUCHED, set())
    deleted: dict[uuid.UUID, dict] = session.info.pop(_DELETED, {})
    touched -= deleted.keys()
    if not touched and not deleted:
        return

    site_tenants = dict(session.execute(
        select(models.Site.id, models.Site.tenant_id).where(models.Site.id.in_(touched))
    ).all()) if touched else {}
    enabled = _enabled_tenants(session, set(site_tenants.values()) | {d["tenant_id"] for d in deleted.values()})
    if not enabled:
        return

    # Sorted so two transactions touching the same sites lock them in one order.
    for site_id in sorted(touched, key=str):
        if site_tenants.get(site_id) in enabled:
            queue_site_snapshot(session, site_id)
    for site_id, info in deleted.items():
        # NSO only knows sites that were eligible; nothing to tell it otherwise.
        if info["tenant_id"] in enabled and nso.is_eligible(info["cafe_code"]):
            enqueue(session, info["tenant_id"], site_id, nso.EVENT_DELETED,
                    nso.tombstone(info["tenant_id"], site_id, info["cafe_code"], info["name"]))


def _clear(session: Session, transaction: Any) -> None:
    # Only when the outermost transaction ends (commit or rollback). A rolled-back
    # SAVEPOINT must not drop sites noted by earlier flushes of the outer one;
    # over-noting is harmless because the snapshot is read from the database.
    if transaction.parent is None:
        session.info.pop(_TOUCHED, None)
        session.info.pop(_DELETED, None)


def register(session_cls: type[Session]) -> None:
    """Attach the hooks to a Session subclass (idempotent)."""
    if event.contains(session_cls, "before_commit", _before_commit):
        return
    event.listen(session_cls, "after_flush", _after_flush)
    event.listen(session_cls, "before_commit", _before_commit)
    event.listen(session_cls, "after_transaction_end", _clear)
