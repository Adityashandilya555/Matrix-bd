"""Undo for whitelisted, side-effect-free approval decisions.

Cross-cutting because the undoable gates live in different modules (design
deliverable reviews, BD site approval). This module owns the generic
scaffolding — the reversible_actions row, the common guards, and the dispatcher
— while each owning service supplies the action-specific capture and restore.

Why a snapshot table and not the audit log: of the 89 write_audit_event call
sites, ~72% record only `action` + free-text `detail`, and the design module
records no before-state at all. So the prior values are captured at action time
in reversible_actions — the same shape that makes archive/revive work
(sites.archived_from_status).

A row exists ONLY for an action that has a hand-written compensating restore, so
the row's existence is itself the whitelist. It is consumed exactly once; the
original audit row is never deleted, so the ledger shows action-then-undo.

Import direction: owning services import THIS module (for record_reversible +
the action constants). This module reaches back into them only via a lazy import
inside the dispatcher, so there is no import cycle.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.db.session import transaction
from app.domain.schemas.common import OkResponse
from app.services._common import actor_is_business_admin, fetch_site_for_update_or_404, fetch_site_or_404

# Action identifiers stored in reversible_actions.action. One per gate with a
# compensating restore. Bump SNAPSHOT_VERSION when the captured field set of ANY
# action changes — the undo refuses an unrecognised version rather than
# restoring a subset, because a partial restore is worse than none.
ACTION_DESIGN_ADMIN_REVIEW = "design_admin_review"
ACTION_DESIGN_SUPERVISOR_REVIEW = "design_supervisor_review"
ACTION_BD_SITE_APPROVAL = "bd_site_approval"
SNAPSHOT_VERSION = 1


def parse_iso_or_none(value: Optional[str]) -> Optional[datetime]:
    """Restore a timestamp the snapshot stored as an ISO string (JSONB has no
    native timestamp). None for null/unparseable rather than raising — an
    unreadable timestamp must not block an otherwise-valid undo."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def record_reversible(
    session: AsyncSession,
    *,
    tenant_id,
    site_id,
    audit_log_id,
    action: str,
    entity_type: str,
    entity_id,
    actor_id,
    before: dict,
    after: dict,
    extra: Optional[dict] = None,
) -> None:
    """Persist one undo snapshot, in the SAME transaction as the action it
    describes — an action is either undoable with a correct snapshot, or it did
    not happen. ``after`` is the frontier baseline: the undo refuses unless the
    live values still match it (this codebase has no version column, and
    Site.updated_at is a never-compared mtime, so an exact field-set comparison
    is what stands in for optimistic locking)."""
    session.add(models.ReversibleAction(
        tenant_id=tenant_id,
        site_id=site_id,
        audit_log_id=audit_log_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        actor_id=actor_id,
        snapshot={
            "snapshot_version": SNAPSHOT_VERSION,
            "before": before,
            "after": after,
            **(extra or {}),
        },
    ))


def assert_nothing_moved(*, expected: dict, live: dict) -> None:
    """Refuse the undo unless every field it would overwrite still holds the
    value the original action left it at. Narrower than a global version token
    but sound: it catches every downstream case that matters in one check (a
    re-submission, a later admin decision, an LOI upload) precisely because those
    all change a field the action touched."""
    for section, fields in expected.items():
        for field, want in fields.items():
            got = (live.get(section) or {}).get(field)
            if got != want:
                raise HTTPException(
                    status_code=http_status.HTTP_409_CONFLICT,
                    detail=(
                        f"This site has moved on since that decision "
                        f"({section}.{field} is now '{got}', expected '{want}'). "
                        f"Undo is no longer safe."
                    ),
                )


async def svc_list_reversible_actions(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict, site_id: str | UUID,
) -> list[models.ReversibleAction]:
    """Open (unconsumed) undoable actions on a site, for THIS actor only.

    Scoped to the caller because only the admin who made a decision may undo it —
    returning another admin's rows would render a button that always 403s."""
    site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
    if not actor_is_business_admin(actor):
        return []
    return list((await session.execute(
        select(models.ReversibleAction)
        .where(
            models.ReversibleAction.site_id == site.id,
            models.ReversibleAction.tenant_id == tenant_id,
            models.ReversibleAction.actor_id == actor["sub"],
            models.ReversibleAction.consumed_at.is_(None),
        )
        .order_by(models.ReversibleAction.created_at.desc())
    )).scalars().all())


async def _fetch_open_reversible_for_update(
    session: AsyncSession, *, reversible_id, site_id, tenant_id,
) -> models.ReversibleAction:
    """Row-lock the snapshot. Tenant- AND site-scoped so a forged id from another
    workspace is a 404, not a leak (concurrency-audit skill invariant #3)."""
    row = (await session.execute(
        select(models.ReversibleAction)
        .where(
            models.ReversibleAction.id == reversible_id,
            models.ReversibleAction.site_id == site_id,
            models.ReversibleAction.tenant_id == tenant_id,
        )
        .with_for_update()
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="That action is not undoable.",
        )
    return row


async def _dispatch_undo(session: AsyncSession, *, row, site, actor) -> None:
    """Route to the owning service's compensating restore. Lazy imports break the
    cycle (those modules import this one at top level)."""
    if row.action in (ACTION_DESIGN_ADMIN_REVIEW, ACTION_DESIGN_SUPERVISOR_REVIEW):
        from app.services import design_service
        await design_service.apply_reversible_undo(session, row=row, site=site, actor=actor)
    elif row.action == ACTION_BD_SITE_APPROVAL:
        from app.services import bd_service
        await bd_service.apply_reversible_undo(session, row=row, site=site, actor=actor)
    else:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail=f"'{row.action}' is not an undoable action.",
        )


async def svc_undo_reversible_action(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    reversible_id: str | UUID,
) -> OkResponse:
    """Undo a whitelisted decision, restoring the values snapshotted at action
    time. Common guards live here; the action-specific hard-stop, frontier check,
    field restore, audit and notification live in the owning service's handler.

    The original audit row is never deleted; the ledger shows action-then-undo.
    """
    if not actor_is_business_admin(actor):
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Only a business admin can undo a decision.",
        )

    async with transaction(session):
        # Lock the SITE first, matching every other site mutation — consistent
        # ordering is what stops this deadlocking against a concurrent decision
        # that takes the same lock.
        site = await fetch_site_for_update_or_404(session, site_id=site_id, tenant_id=tenant_id)
        row = await _fetch_open_reversible_for_update(
            session, reversible_id=reversible_id, site_id=site.id, tenant_id=tenant_id,
        )

        if str(row.actor_id) != str(actor["sub"]):
            raise HTTPException(
                status_code=http_status.HTTP_403_FORBIDDEN,
                detail="Only the admin who made this decision can undo it.",
            )
        if row.consumed_at is not None:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail="That decision has already been undone.",
            )
        if (row.snapshot or {}).get("snapshot_version") != SNAPSHOT_VERSION:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail=(
                    "This decision was recorded by an older version of the app "
                    "and can no longer be undone automatically."
                ),
            )

        await _dispatch_undo(session, row=row, site=site, actor=actor)

        row.consumed_at = datetime.now(timezone.utc)
        row.consumed_by = actor["sub"]

    return OkResponse(message="Decision undone.")
