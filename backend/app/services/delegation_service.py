"""Shortlist delegation service.

Encapsulates the rules around per-site shortlist delegations so the router
stays thin. See `shortlist_delegations` table.

Delegation model (per the product spec):
    - A *supervisor* may delegate a specific shortlist site to an executive
      (typically when the supervisor wants a field exec to own it end-to-end).
    - The supervisor never loses their own approval power — delegation is
      additive, not exclusive. Both can act.
    - Executives cannot grant delegations to others; they can only receive them.
    - A delegation is revocable. Revocation sets `revoked_at` / `revoked_by`;
      we never delete the row so the audit history is complete.

API surface (see `routers/delegations.py`):
    POST   /sites/{site_id}/delegations          — grant
    DELETE /delegations/{delegation_id}          — revoke
    GET    /sites/{site_id}/delegations          — list active for a site
    GET    /delegations/mine                     — active delegations for me
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.db.session import transaction
from app.domain.schemas.common import OkResponse
from app.services._common import fetch_site_or_404
from app.services.audit_service import write_audit_event

logger = logging.getLogger(__name__)


async def svc_grant_delegation(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    delegate_user_id: str | UUID,
    notes: Optional[str] = None,
) -> dict:
    """Grant a supervisor's shortlist delegation for a site to an active executive delegate."""
    if (actor.get("role") or "").lower() != "supervisor":
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Only the supervisor can delegate a shortlist site.",
        )
    if str(delegate_user_id) == str(actor["sub"]):
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Cannot delegate to yourself.",
        )

    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)

        # Confirm the delegate exists in this tenant and is active.
        delegate = (await session.execute(
            select(models.User).where(
                models.User.id == delegate_user_id,
                models.User.tenant_id == tenant_id,
                models.User.is_active.is_(True),
            )
        )).scalar_one_or_none()
        if delegate is None:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="Delegate user not found in this workspace, or not active.",
            )
        # Only executives are eligible delegates. Other supervisors already
        # have full power, so delegating to them would be a no-op.
        if (delegate.role or "").lower() != "executive":
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Delegations can only be granted to executive users.",
            )

        # If an active delegation for the same (site, delegate) already
        # exists, refuse rather than silently double-granting.
        existing = (await session.execute(
            select(models.ShortlistDelegation).where(
                models.ShortlistDelegation.site_id == site.id,
                models.ShortlistDelegation.delegate_user_id == delegate_user_id,
                models.ShortlistDelegation.revoked_at.is_(None),
            )
        )).scalar_one_or_none()
        if existing is not None:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail="An active delegation for this site + user already exists.",
            )

        row = models.ShortlistDelegation(
            tenant_id=tenant_id,
            site_id=site.id,
            delegate_user_id=delegate_user_id,
            granted_by=actor["sub"],
            notes=(notes or "").strip() or None,
        )
        session.add(row)
        await session.flush()

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="grant_shortlist_delegation",
            entity_id=row.id, entity_type="shortlist_delegation",
            detail=f"delegate={delegate.email} notes={row.notes or ''}",
        )
    return {
        "id": str(row.id),
        "site_id": str(row.site_id),
        "delegate_user_id": str(row.delegate_user_id),
        "delegate_email": delegate.email,
        "granted_by": str(row.granted_by),
        "granted_at": row.granted_at.isoformat() if row.granted_at else None,
        "notes": row.notes,
    }


async def svc_revoke_delegation(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    delegation_id: str | UUID,
) -> OkResponse:
    """Revoke a delegation by id, staying idempotent if it was already revoked."""
    if (actor.get("role") or "").lower() != "supervisor":
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Only the supervisor can revoke a delegation.",
        )
    async with transaction(session):
        row = (await session.execute(
            select(models.ShortlistDelegation).where(
                models.ShortlistDelegation.id == delegation_id,
                models.ShortlistDelegation.tenant_id == tenant_id,
            )
        )).scalar_one_or_none()
        if row is None:
            raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Delegation not found.")
        if row.revoked_at is not None:
            return OkResponse(message="Delegation was already revoked.")
        row.revoked_at = datetime.now(timezone.utc)
        row.revoked_by = actor["sub"]
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=row.site_id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="revoke_shortlist_delegation",
            entity_id=row.id, entity_type="shortlist_delegation",
        )
    return OkResponse(message="Delegation revoked.")


async def svc_list_delegations_for_site(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    site_id: str | UUID,
) -> dict:
    """Return all active delegations for a site, newest first, with delegate email and name."""
    stmt = (
        select(models.ShortlistDelegation, models.User.email, models.User.name)
        .join(models.User, models.User.id == models.ShortlistDelegation.delegate_user_id)
        .where(
            models.ShortlistDelegation.site_id == site_id,
            models.ShortlistDelegation.tenant_id == tenant_id,
            models.ShortlistDelegation.revoked_at.is_(None),
        )
        .order_by(models.ShortlistDelegation.granted_at.desc())
    )
    rows = (await session.execute(stmt)).all()
    return {
        "items": [
            {
                "id": str(d.id),
                "delegate_user_id": str(d.delegate_user_id),
                "delegate_email": email,
                "delegate_name": name,
                "granted_by": str(d.granted_by),
                "granted_at": d.granted_at.isoformat() if d.granted_at else None,
                "notes": d.notes,
            }
            for (d, email, name) in rows
        ],
        "total": len(rows),
    }


async def svc_list_my_delegations(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
) -> dict:
    """Return active delegations granted to the calling user, newest first, with site details."""
    stmt = (
        select(models.ShortlistDelegation, models.Site.code, models.Site.name, models.Site.city)
        .join(models.Site, models.Site.id == models.ShortlistDelegation.site_id)
        .where(
            models.ShortlistDelegation.delegate_user_id == actor["sub"],
            models.ShortlistDelegation.tenant_id == tenant_id,
            models.ShortlistDelegation.revoked_at.is_(None),
        )
        .order_by(models.ShortlistDelegation.granted_at.desc())
    )
    rows = (await session.execute(stmt)).all()
    return {
        "items": [
            {
                "id": str(d.id),
                "site_id": str(d.site_id),
                "site_code": code,
                "site_name": name,
                "site_city": city,
                "granted_at": d.granted_at.isoformat() if d.granted_at else None,
                "notes": d.notes,
            }
            for (d, code, name, city) in rows
        ],
        "total": len(rows),
    }


async def actor_has_delegation_for_site(
    session: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID, user_id: str | UUID,
) -> bool:
    """Boolean check used by other services that want to honour a delegation
    on a site."""
    row = (await session.execute(
        select(models.ShortlistDelegation.id).where(
            models.ShortlistDelegation.tenant_id == tenant_id,
            models.ShortlistDelegation.site_id == site_id,
            models.ShortlistDelegation.delegate_user_id == user_id,
            models.ShortlistDelegation.revoked_at.is_(None),
        ).limit(1)
    )).first()
    return row is not None


# ── Module-aware delegations (site_delegations table) ──────────────────────
# Used by the Legal module today; Payment will reuse the same surface.
#
# Defensive default: every reader (`svc_assigned_sites`, `svc_is_delegated`)
# returns an empty / False result instead of raising when the table is empty
# or absent. This keeps executive flows usable even before the migration has
# landed in every environment.

_VALID_MODULES = {"bd", "legal", "payment", "design", "project", "nso", "project_excellence", "financial_closure"}


def _assert_module(module: str) -> str:
    m = (module or "").lower()
    if m not in _VALID_MODULES:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported delegation module: {module!r}",
        )
    return m


async def svc_delegate_legal(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    delegate_user_id: str | UUID,
    notes: Optional[str] = None,
) -> dict:
    """Supervisor grants legal responsibility for a site to an executive.

    Only role=supervisor in the legal module may call this (the route guards
    role; we additionally enforce 'delegate must be executive' here).
    """
    from app.services.notification_service import enqueue as notify_enqueue

    if (actor.get("role") or "").lower() != "supervisor":
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Only a supervisor can delegate a legal site.",
        )
    if str(delegate_user_id) == str(actor["sub"]):
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Cannot delegate to yourself.",
        )

    module = "legal"

    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)

        delegate = (await session.execute(
            select(models.User).where(
                models.User.id == delegate_user_id,
                models.User.tenant_id == tenant_id,
                models.User.is_active.is_(True),
            )
        )).scalar_one_or_none()
        if delegate is None:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="Delegate user not found in this workspace, or not active.",
            )
        if (delegate.role or "").lower() != "executive":
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Delegations can only be granted to executive users.",
            )

        existing = (await session.execute(
            select(models.SiteDelegation).where(
                models.SiteDelegation.site_id == site.id,
                models.SiteDelegation.module == module,
                models.SiteDelegation.delegate_user_id == delegate_user_id,
                models.SiteDelegation.revoked_at.is_(None),
            )
        )).scalar_one_or_none()
        if existing is not None:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail="An active legal delegation for this site + user already exists.",
            )

        row = models.SiteDelegation(
            tenant_id=tenant_id,
            site_id=site.id,
            module=module,
            delegate_user_id=delegate_user_id,
            granted_by=actor["sub"],
            notes=(notes or "").strip() or None,
        )
        session.add(row)
        await session.flush()

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="legal_delegation_granted",
            entity_id=row.id, entity_type="site_delegation",
            detail=f"delegate={delegate.email} module={module} notes={row.notes or ''}",
        )

        await notify_enqueue(
            session, tenant_id=tenant_id, event="legal_delegated",
            recipient_ids=[delegate.id], site_id=site.id,
            channels=("in_app",),
            payload={
                "site_id": str(site.id),
                "site_name": site.name,
                "module": module,
            },
            subject=f"Legal site assigned: {site.name}",
            body=(
                f"You have been delegated legal responsibility for '{site.name}' ({site.code}). "
                f"Open the Legal queue to begin the DDR."
            ),
        )

    return {
        "id": str(row.id),
        "site_id": str(row.site_id),
        "module": row.module,
        "delegate_user_id": str(row.delegate_user_id),
        "delegate_email": delegate.email,
        "delegate_name": delegate.name,
        "granted_by": str(row.granted_by),
        "granted_at": row.granted_at.isoformat() if row.granted_at else None,
        "notes": row.notes,
    }


async def svc_revoke_legal_delegation(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    delegate_user_id: str | UUID,
) -> OkResponse:
    """Supervisor revokes an active legal delegation by (site, user).

    Idempotent: a no-op (200 with friendly message) if no active row exists,
    so the UI's "remove" button can always be safely clicked.
    """
    if (actor.get("role") or "").lower() != "supervisor":
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Only a supervisor can revoke a legal delegation.",
        )

    async with transaction(session):
        row = (await session.execute(
            select(models.SiteDelegation).where(
                models.SiteDelegation.tenant_id == tenant_id,
                models.SiteDelegation.site_id == site_id,
                models.SiteDelegation.module == "legal",
                models.SiteDelegation.delegate_user_id == delegate_user_id,
                models.SiteDelegation.revoked_at.is_(None),
            )
        )).scalar_one_or_none()
        if row is None:
            return OkResponse(message="No active legal delegation to revoke.")
        row.revoked_at = datetime.now(timezone.utc)
        row.revoked_by = actor["sub"]
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=row.site_id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="legal_delegation_revoked",
            entity_id=row.id, entity_type="site_delegation",
        )
    return OkResponse(message="Legal delegation revoked.")


async def svc_assigned_sites(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    user_id: str | UUID,
    module: str,
) -> list[str]:
    """Return active-delegation site ids (as str) for (user, module, tenant).

    Defensive default: returns [] on missing table / no rows / DB error, so
    callers can use it as an *additive* filter without breaking if the
    migration hasn't run yet.
    """
    module = _assert_module(module)
    try:
        stmt = select(models.SiteDelegation.site_id).where(
            models.SiteDelegation.tenant_id == tenant_id,
            models.SiteDelegation.module == module,
            models.SiteDelegation.delegate_user_id == user_id,
            models.SiteDelegation.revoked_at.is_(None),
        )
        rows = (await session.execute(stmt)).scalars().all()
        return [str(r) for r in rows]
    except Exception:
        logger.exception(
            "delegation_service.svc_assigned_sites failed (tenant=%s, user=%s, module=%s) — "
            "returning safe default []", tenant_id, user_id, module,
        )
        return []


async def svc_is_delegated(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    site_id: str | UUID,
    user_id: str | UUID,
    module: str,
) -> bool:
    """Boolean: is `user_id` an active delegate for `site_id` in `module`?

    Defensive default: returns False on any error.
    """
    module = _assert_module(module)
    try:
        row = (await session.execute(
            select(models.SiteDelegation.id).where(
                models.SiteDelegation.tenant_id == tenant_id,
                models.SiteDelegation.site_id == site_id,
                models.SiteDelegation.module == module,
                models.SiteDelegation.delegate_user_id == user_id,
                models.SiteDelegation.revoked_at.is_(None),
            ).limit(1)
        )).first()
    except Exception:
        logger.exception(
            "delegation_service.svc_is_delegated failed (tenant=%s, site=%s, user=%s, module=%s) — "
            "returning safe default False", tenant_id, site_id, user_id, module,
        )
        return False
    else:
        return row is not None


async def svc_list_legal_delegations_for_site(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    site_id: str | UUID,
) -> dict:
    """Return active legal delegations for a single site (supervisor view)."""
    try:
        stmt = (
            select(models.SiteDelegation, models.User.email, models.User.name)
            .join(models.User, models.User.id == models.SiteDelegation.delegate_user_id)
            .where(
                models.SiteDelegation.site_id == site_id,
                models.SiteDelegation.tenant_id == tenant_id,
                models.SiteDelegation.module == "legal",
                models.SiteDelegation.revoked_at.is_(None),
            )
            .order_by(models.SiteDelegation.granted_at.desc())
        )
        rows = (await session.execute(stmt)).all()
    except Exception:
        logger.exception(
            "delegation_service.svc_list_legal_delegations_for_site failed (tenant=%s, site=%s) — "
            "returning empty list", tenant_id, site_id,
        )
        return {"items": [], "total": 0}
    return {
        "items": [
            {
                "id": str(d.id),
                "site_id": str(d.site_id),
                "module": d.module,
                "delegate_user_id": str(d.delegate_user_id),
                "delegate_email": email,
                "delegate_name": name,
                "granted_by": str(d.granted_by),
                "granted_at": d.granted_at.isoformat() if d.granted_at else None,
                "notes": d.notes,
            }
            for (d, email, name) in rows
        ],
        "total": len(rows),
    }


async def svc_list_my_legal_assignments(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
) -> dict:
    """Executive view: list sites I'm delegated to in the legal module,
    restricted to states the legal module owns (LEGAL_REVIEW / LEGAL_APPROVED).

    Defensive default: returns an empty list on table-missing or any error.
    """
    try:
        stmt = (
            select(
                models.SiteDelegation,
                models.Site.code, models.Site.name, models.Site.city, models.Site.status,
                models.Site.legal_dd_status, models.Site.legal_review_at,
            )
            .join(models.Site, models.Site.id == models.SiteDelegation.site_id)
            .where(
                models.SiteDelegation.delegate_user_id == actor["sub"],
                models.SiteDelegation.tenant_id == tenant_id,
                models.SiteDelegation.module == "legal",
                models.SiteDelegation.revoked_at.is_(None),
                models.Site.status.in_(("legal_review", "legal_approved")),
            )
            .order_by(models.SiteDelegation.granted_at.desc())
        )
        rows = (await session.execute(stmt)).all()
    except Exception:
        logger.exception(
            "delegation_service.svc_list_my_legal_assignments failed (tenant=%s, actor=%s) — "
            "returning empty list", tenant_id, actor.get("sub"),
        )
        return {"items": [], "total": 0}

    return {
        "items": [
            {
                "id": str(d.id),
                "site_id": str(d.site_id),
                "site_code": code or "",
                "site_name": name,
                "city": city,
                "site_status": status_,
                "legal_dd_status": legal_dd_status or "pending",
                "legal_review_at": legal_review_at.isoformat() if legal_review_at else None,
                "granted_at": d.granted_at.isoformat() if d.granted_at else None,
                "notes": d.notes,
            }
            for (d, code, name, city, status_, legal_dd_status, legal_review_at) in rows
        ],
        "total": len(rows),
    }
