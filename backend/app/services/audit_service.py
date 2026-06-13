"""Audit service — inserts a row in `audit_logs` on every state transition
or field edit, and co-writes a `stage_events` row whenever a status
transition is present (from_status / to_status).

`stage_events` is the immutable event ledger that SLA / analytics queries
read.  Previously it was declared in the schema but never written — fixed
here (issue #119).
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models


async def write_audit_event(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    site_id: str | UUID | None,
    actor_id: str | UUID | None,
    actor_name: str | None,
    action: str,
    from_status: str | None = None,
    to_status: str | None = None,
    detail: str | None = None,
    field_name: str | None = None,
    from_value: str | None = None,
    to_value: str | None = None,
    entity_id: str | UUID | None = None,
    entity_type: str | None = None,
    actor_role: str | None = None,
) -> models.AuditLog:
    """Persist an audit row *and* (when a status transition is present) a
    stage_events row.  The caller's transaction is reused.

    `actor_name` is denormalised so the activity tab can render without a join.
    `actor_role` is stored in stage_events for SLA/analytics attribution; it is
    silently ignored by the audit_logs row (which identifies actors via actor_id).
    """
    row = models.AuditLog(
        tenant_id=tenant_id,
        site_id=site_id,
        actor_id=actor_id,
        actor_name=actor_name,
        action=action,
        from_status=from_status,
        to_status=to_status,
        detail=detail,
        field_name=field_name,
        from_value=from_value,
        to_value=to_value,
        entity_id=entity_id,
        entity_type=entity_type,
    )
    session.add(row)
    await session.flush()  # ensure id is populated

    # ── Co-write stage_events whenever a status transition is recorded ────────
    # stage_events is the immutable ledger for SLA / analytics pipelines.
    # We only emit it for transitions (at least one of from/to_status set) and
    # only when the event is scoped to a site (site_id required by the FK).
    if site_id is not None and (from_status is not None or to_status is not None):
        stage = models.StageEvent(
            tenant_id=tenant_id,
            site_id=site_id,
            actor_id=actor_id,
            event_type=action,
            from_status=from_status,
            to_status=to_status,
            actor_role=actor_role,
        )
        session.add(stage)
        await session.flush()

    return row


PIPELINE_FIELDS = ("model", "spoc_name", "google_pin", "expected_rent", "rent_type")

# Map the public/incoming key → the audit field_name we want to record.
# Special-case: `google_pin` is what the UI calls it; the DB column is google_maps_pin.
_FIELD_AUDIT_LABEL = {
    "model": "model",
    "spoc_name": "spoc_name",
    "google_pin": "google_pin",
    "expected_rent": "expected_rent",
    "rent_type": "rent_type",
}


async def diff_and_log_pipeline_fields(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    site_id: str | UUID,
    actor_id: str | UUID | None,
    actor_name: str | None,
    before: dict,
    after: dict,
) -> int:
    """Compare pipeline-stage fields before/after; emit one row per change.

    `before` is the current state pulled from the sites row; `after` is the
    incoming payload. Skips fields whose new value is None (partial-save).
    """
    written = 0
    for field in PIPELINE_FIELDS:
        new_val = after.get(field)
        if new_val is None or new_val == "":
            continue
        old_val = before.get(field)
        if str(old_val) == str(new_val):
            continue
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site_id,
            actor_id=actor_id,
            actor_name=actor_name,
            action="pipeline_field_edited",
            field_name=_FIELD_AUDIT_LABEL[field],
            from_value=None if old_val is None else str(old_val),
            to_value=str(new_val),
        )
        written += 1
    return written
