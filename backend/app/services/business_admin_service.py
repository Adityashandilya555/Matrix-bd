"""Business-admin service: per-module dept codes + pending-supervisor approvals.

These endpoints power the /business-admin portal. The `module_codes` and
`user_module_memberships` tables live outside the SQLAlchemy ORM, so this
module talks to them via raw `text()` queries.

Pending supervisors are encoded in the existing `users` table as
`role='supervisor' AND is_active=false`. The module they applied for is
stashed in `users.notes` as the marker
`pending_module:<bd|legal|payment|design|project>`.
On approval we activate the user, drop the marker, and register the module
membership; on rejection we delete the row.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import desc, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.db.session import transaction
from app.domain.schemas.business_admin import Module
from app.services._common import fetch_user_name
from app.services.finance_service import svc_finance_approve


_PENDING_MODULE_PREFIX = "pending_module:"
_VALID_MODULES: frozenset[str] = frozenset(("bd", "legal", "payment", "design", "project"))


def _new_dept_code() -> str:
    return secrets.token_urlsafe(8).upper()


def _parse_pending_module(notes: Optional[str]) -> Optional[str]:
    """Return the module a pending supervisor applied for, or None if the
    marker is missing/malformed."""
    if not notes or not notes.startswith(_PENDING_MODULE_PREFIX):
        return None
    candidate = notes[len(_PENDING_MODULE_PREFIX):].strip().lower()
    return candidate if candidate in _VALID_MODULES else None


async def list_dept_codes(session: AsyncSession, tenant_id: str | UUID) -> list[dict]:
    rows = (await session.execute(
        text("""
            SELECT id, module, code, created_at, rotated_at
              FROM module_codes
             WHERE tenant_id = :tid
             ORDER BY module
        """),
        {"tid": tenant_id},
    )).mappings().all()
    return [
        {
            "id": str(r["id"]),
            "module": r["module"],
            "code": r["code"],
            "created_at": r["created_at"],
            "rotated_at": r["rotated_at"],
        }
        for r in rows
    ]


async def rotate_dept_code(
    session: AsyncSession,
    tenant_id: str | UUID,
    module: Module,
    created_by: str | UUID,
) -> dict:
    async with transaction(session):
        row = (await session.execute(
            text("""
                INSERT INTO module_codes (tenant_id, module, code, created_by)
                VALUES (:tid, :module, :code, :uid)
                ON CONFLICT (tenant_id, module) DO UPDATE
                  SET code = EXCLUDED.code,
                      rotated_at = now(),
                      created_by = EXCLUDED.created_by
                RETURNING module, code
            """),
            {"tid": tenant_id, "module": module, "code": _new_dept_code(), "uid": created_by},
        )).mappings().one()
    return {"module": row["module"], "code": row["code"]}


async def list_pending_supervisors(
    session: AsyncSession,
    tenant_id: str | UUID,
    module: Optional[Module] = None,
) -> list[dict]:
    rows = (await session.execute(
        text("""
            SELECT id, email, notes, created_at
              FROM users
             WHERE tenant_id = :tid
               AND role = 'supervisor'
               AND is_active = false
             ORDER BY created_at
        """),
        {"tid": tenant_id},
    )).mappings().all()

    items: list[dict] = []
    for r in rows:
        parsed = _parse_pending_module(r["notes"])
        if parsed is None:
            continue
        if module is not None and parsed != module:
            continue
        items.append({
            "id": str(r["id"]),
            "email": r["email"],
            "module": parsed,
            "created_at": r["created_at"],
        })
    return items


async def approve_supervisor(
    session: AsyncSession,
    tenant_id: str | UUID,
    user_id: str | UUID,
    module: Module,
) -> None:
    async with transaction(session):
        await session.execute(
            text("""
                UPDATE users
                   SET is_active = true,
                       notes = NULL
                 WHERE id = CAST(:uid AS uuid)
                   AND tenant_id = :tid
            """),
            {"uid": user_id, "tid": tenant_id},
        )
        await session.execute(
            text("""
                INSERT INTO user_module_memberships
                       (user_id, tenant_id, module, role_in_module, supervisor_id)
                VALUES (CAST(:uid AS uuid), :tid, :module, 'supervisor', NULL)
            """),
            {"uid": user_id, "tid": tenant_id, "module": module},
        )


async def reject_supervisor(
    session: AsyncSession,
    tenant_id: str | UUID,
    user_id: str | UUID,
) -> None:
    async with transaction(session):
        await session.execute(
            text("""
                DELETE FROM users
                 WHERE id = CAST(:uid AS uuid)
                   AND tenant_id = :tid
                   AND is_active = false
            """),
            {"uid": user_id, "tid": tenant_id},
        )


async def list_finance_approvals(
    session: AsyncSession,
    tenant_id: str | UUID,
) -> list[dict]:
    rows = (await session.execute(
        select(models.Site)
        .where(
            models.Site.tenant_id == tenant_id,
            models.Site.finance_status == "awaiting_admin",
        )
        .order_by(models.Site.updated_at.asc())
    )).scalars().all()

    items: list[dict] = []
    now = datetime.now(timezone.utc)
    for site in rows:
        updated_at = site.updated_at or site.created_at or now
        try:
            finance_amount = (
                float(site.finance_amount)
                if site.finance_amount is not None
                else None
            )
        except (TypeError, ValueError):
            finance_amount = None
        items.append({
            "site_id": str(site.id),
            "site_code": site.ca_code or site.code or f"SITE-{str(site.id)[:8].upper()}",
            "site_name": site.name or "Unnamed site",
            "city": site.city or "Unknown city",
            "site_status": site.status or "pending",
            "submitted_by_name": await fetch_user_name(session, site.submitted_by),
            "ca_code": site.ca_code,
            "finance_amount": finance_amount,
            "kyc_verified": bool(site.kyc_verified),
            "finance_status": site.finance_status or "awaiting_admin",
            "updated_at": updated_at,
        })
    return items


async def list_admin_sites(
    session: AsyncSession,
    tenant_id: str | UUID,
    limit: int = 80,
) -> dict:
    try:
        safe_limit = int(limit)
    except (TypeError, ValueError):
        safe_limit = 80
    safe_limit = max(1, min(safe_limit, 200))
    rows = (await session.execute(
        select(models.Site)
        .where(models.Site.tenant_id == tenant_id)
        .order_by(desc(models.Site.updated_at))
        .limit(safe_limit)
    )).scalars().all()

    user_ids = set()
    for site in rows:
        if site.submitted_by:
            user_ids.add(site.submitted_by)
        if site.assigned_to:
            user_ids.add(site.assigned_to)
        if site.supervisor_id:
            user_ids.add(site.supervisor_id)

    names: dict = {}
    if user_ids:
        pairs = (await session.execute(
            select(models.User.id, models.User.name).where(models.User.id.in_(user_ids))
        )).all()
        names = {uid: name for uid, name in pairs}

    items = []
    now = datetime.now(timezone.utc)
    for site in rows:
        created_at = site.created_at or site.updated_at or now
        updated_at = site.updated_at or site.created_at or now
        try:
            finance_amount = (
                float(site.finance_amount)
                if site.finance_amount is not None
                else None
            )
        except (TypeError, ValueError):
            finance_amount = None
        items.append({
            "site_id": str(site.id),
            "site_code": site.ca_code or site.code or f"SITE-{str(site.id)[:8].upper()}",
            "site_name": site.name or "Unnamed site",
            "city": site.city or "Unknown city",
            "site_status": site.status or "pending",
            "submitted_by_name": names.get(site.submitted_by),
            "assigned_to_name": names.get(site.assigned_to) if site.assigned_to else None,
            "supervisor_name": names.get(site.supervisor_id) if site.supervisor_id else None,
            "legal_dd_status": site.legal_dd_status,
            "agreement_status": site.agreement_status,
            "licensing_status": site.licensing_status,
            "finance_status": site.finance_status or "pending",
            "design_status": site.design_status,
            "ca_code": site.ca_code,
            "finance_amount": finance_amount,
            "kyc_verified": bool(site.kyc_verified),
            "created_at": created_at,
            "updated_at": updated_at,
            "draft_submitted_at": site.draft_submitted_at,
            "shortlisted_at": site.shortlisted_at,
            "details_submitted_at": site.details_submitted_at,
            "approved_at": site.approved_at,
            "loi_uploaded_at": site.loi_uploaded_at,
            "legal_review_at": site.legal_review_at,
            "legal_approved_at": site.legal_approved_at,
            "legal_rejected_at": site.legal_rejected_at,
            "pushed_to_payments_at": site.pushed_to_payments_at,
            "design_approved_at": site.design_approved_at,
            "rejection_reason": site.rejection_reason,
        })
    return {"items": items, "total": len(items)}


async def approve_finance(
    session: AsyncSession,
    tenant_id: str | UUID,
    site_id: str | UUID,
    actor: dict,
) -> dict:
    return await svc_finance_approve(
        session,
        tenant_id=tenant_id,
        actor=actor,
        site_id=site_id,
    )
