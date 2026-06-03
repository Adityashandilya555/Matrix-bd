"""Cross-module unlock helpers.

Finance / CA and Legal run in parallel after LOI. Design opens only once both
parallel tracks have reached their gates:

  sites.legal_dd_status = 'positive'
  sites.finance_status = 'approved'

The historical linear `sites.status` still exists for BD dashboards, so this
helper updates it only when doing so is compatible with the current state.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.domain.state_machine import SiteStatus, assert_transition
from app.services.audit_service import write_audit_event


def design_unlock_ready(site: models.Site) -> bool:
    return (site.legal_dd_status or "pending") == "positive" and (
        site.finance_status or "pending"
    ) == "approved"


async def maybe_unlock_design(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site: models.Site,
    reason: str,
) -> bool:
    """Open the design queue once DDR and finance are both approved.

    Returns True when a visible state changed. The helper is intentionally safe
    to call after either track completes; duplicate calls become no-ops.
    """
    if not design_unlock_ready(site):
        return False

    changed = False
    if not site.design_status:
        site.design_status = "pending"
        changed = True

    now = datetime.now(timezone.utc)
    if site.status == SiteStatus.LEGAL_APPROVED.value:
        assert_transition(SiteStatus(site.status), SiteStatus.PUSHED_TO_PAYMENTS)
        site.status = SiteStatus.PUSHED_TO_PAYMENTS.value
        site.pushed_to_payments_at = site.pushed_to_payments_at or now
        changed = True
    elif site.status == SiteStatus.PUSHED_TO_PAYMENTS.value and site.pushed_to_payments_at is None:
        site.pushed_to_payments_at = now
        changed = True

    if changed:
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=site.id,
            actor_id=actor["sub"],
            actor_name=actor.get("name"),
            action="design_unlocked",
            detail=f"Design unlocked after parallel Finance + DDR gates. reason={reason}",
        )
    return changed
