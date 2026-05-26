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


async def svc_grant_delegation(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    delegate_user_id: str | UUID,
    notes: Optional[str] = None,
) -> dict:
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
