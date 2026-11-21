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

Safety: a user's save must never fail because of this integration. The work
runs inside a SAVEPOINT; if anything in it raises (a bug, a missing table), the
savepoint is rolled back, the error is logged, and the user's commit goes on
without the event. Capture can also be switched off for the process
(``set_active(False)``), which app.main does when the integration tables are
missing at boot. Tests pass ``strict=True`` to see errors instead.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import event, insert, inspect, select
from sqlalchemy.orm import Session

from app.db import models
from app.integrations import nso_payload as nso

log = logging.getLogger("matrix.integrations.capture")

_TOUCHED = "nso_touched_sites"
_DELETED = "nso_deleted_sites"
_RENAMED = "nso_renamed_tenants"


def note_tenant_renamed(session: Session, tenant_id: Any) -> None:
    """Workspace renames use raw SQL, which the hooks can't see: call this so
    the next commit re-queues the workspace's sites (``company.name``)."""
    session.info.setdefault(_RENAMED, set()).add(uuid.UUID(str(tenant_id)))


class _State:
    """Process-wide switches (a class, not module globals: see test_hygiene_globals)."""
    active = True   # False when the integration tables are missing at boot
    strict = False  # tests: re-raise instead of logging


def set_active(active: bool) -> None:
    """Turn capture on or off for this process."""
    _State.active = active


def set_strict(strict: bool) -> None:
    """Re-raise capture errors instead of logging them (tests only)."""
    _State.strict = strict


def _site_id_of(obj: Any) -> uuid.UUID | None:
    return obj.id if isinstance(obj, models.Site) else getattr(obj, "site_id", None)


def _changed(obj: Any, attrs: frozenset[str], is_new: bool) -> bool:
    if is_new:
        return True
    state = inspect(obj)
    return any(state.attrs[name].history.has_changes() for name in attrs)


def _committed(obj: Any, name: str) -> Any:
    """The attribute's value as last loaded from the database (pre-change).

    Never triggers a load: an expired attribute on a deleted row would raise
    ObjectDeletedError inside the flush. Unloaded → None.
    """
    state = inspect(obj)
    hist = state.attrs[name].history
    if hist.deleted:
        return hist.deleted[0]
    return state.dict.get(name)


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
                "cafe_code": nso.shared_cafe_code(_committed(obj, "ca_code"), _committed(obj, "finance_status")),
                "name": _committed(obj, "name"),
            }


def _enabled_filter():
    ep = models.IntegrationEndpoint
    return select(ep.tenant_id).where(ep.integration == nso.INTEGRATION, ep.enabled.is_(True))


def _last_payload(session: Session, tenant_id: uuid.UUID, site_id: uuid.UUID) -> dict | None:
    """Last snapshot NSO got or will get. Dead rows don't count: NSO never
    received them, so a backfill must be able to send that state again."""
    ob = models.IntegrationOutbox
    return session.execute(
        select(ob.payload)
        .where(ob.tenant_id == tenant_id, ob.integration == nso.INTEGRATION, ob.site_id == site_id,
               ob.status != "dead")
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
    # before_commit also fires when a SAVEPOINT is released; only the outermost
    # commit queues events (savepoint changes are still noted by after_flush).
    if not _State.active or session.in_nested_transaction():
        return
    session.flush()  # run after_flush for anything still pending
    touched: set[uuid.UUID] = session.info.pop(_TOUCHED, set())
    deleted: dict[uuid.UUID, dict] = session.info.pop(_DELETED, {})
    renamed: set[uuid.UUID] = session.info.pop(_RENAMED, set())
    if not touched and not deleted and not renamed:
        return
    try:
        with session.begin_nested():
            if renamed:
                touched |= _eligible_sites_of(session, renamed)
            _queue(session, touched, deleted)
    except Exception:
        if _State.strict:
            raise
        log.exception("nso capture failed; the save goes on without an NSO event (sites=%s)",
                      sorted(map(str, touched | deleted.keys())))


def _eligible_sites_of(session: Session, tenant_ids: set[uuid.UUID]) -> set[uuid.UUID]:
    site = models.Site
    return set(session.execute(
        select(site.id).where(site.tenant_id.in_(tenant_ids), site.ca_code.isnot(None),
                              site.finance_status == "approved")
    ).scalars())


def _queue(session: Session, touched: set[uuid.UUID], deleted: dict[uuid.UUID, dict]) -> None:

    # One query: which noted sites still exist AND belong to an enabled workspace.
    # A site in `deleted` that still exists had its delete rolled back with a
    # SAVEPOINT; it is treated as touched, not deleted.
    site = models.Site
    live_enabled = set(session.execute(
        select(site.id).where(site.id.in_(touched | deleted.keys()), site.tenant_id.in_(_enabled_filter()))
    ).scalars())
    still_there = set(session.execute(
        select(site.id).where(site.id.in_(deleted.keys()))
    ).scalars()) if deleted else set()
    deleted = {k: v for k, v in deleted.items() if k not in still_there}
    touched = (touched | still_there) - deleted.keys()

    # Sorted so two transactions touching the same sites lock them in one order.
    for site_id in sorted(touched & live_enabled, key=str):
        queue_site_snapshot(session, site_id)
    if not deleted:
        return
    # Any endpoint row, switched on or not: a tombstone queued while the
    # integration is off is parked by the sender and goes out once it is back
    # on (a backfill only covers live sites, so it would otherwise be lost).
    ep = models.IntegrationEndpoint
    enabled_tenants = set(session.execute(
        select(ep.tenant_id).where(ep.integration == nso.INTEGRATION,
                                   ep.tenant_id.in_({d["tenant_id"] for d in deleted.values()}))
    ).scalars())
    for site_id, info in deleted.items():
        # Only sites NSO actually has a record of: anything was sent for it (not
        # dead). That includes a site that later lost its code and got its final
        # update; a site with a code that was never sent gets nothing.
        if info["tenant_id"] not in enabled_tenants:
            continue
        if _last_payload(session, info["tenant_id"], site_id) is not None:
            enqueue(session, info["tenant_id"], site_id, nso.EVENT_DELETED,
                    nso.tombstone(info["tenant_id"], site_id, info["cafe_code"], info["name"]))


def _clear(session: Session, transaction: Any) -> None:
    # Only when the outermost transaction ends (commit or rollback). A rolled-back
    # SAVEPOINT must not drop sites noted by earlier flushes of the outer one;
    # over-noting is harmless because the snapshot is read from the database.
    if transaction.parent is None:
        session.info.pop(_TOUCHED, None)
        session.info.pop(_DELETED, None)
        session.info.pop(_RENAMED, None)


def register(session_cls: type[Session]) -> None:
    """Attach the hooks to a Session subclass (idempotent)."""
    if event.contains(session_cls, "before_commit", _before_commit):
        return
    event.listen(session_cls, "after_flush", _after_flush)
    event.listen(session_cls, "before_commit", _before_commit)
    event.listen(session_cls, "after_transaction_end", _clear)


def _register_default() -> None:
    from app.db.session import MatrixSession
    register(MatrixSession)


_register_default()
