"""Data-access helpers for the auth router (#234, 12.2; #378).

Centralises the auth SQL so the routes stay thin and never build SQL directly.
Originally just the two most common primitives — resolve a tenant by
workspace_code, resolve a user by (tenant, email) — which were copy-pasted
across the auth + tenancy routers, so the case-folding contract
(``upper(workspace_code)`` / ``lower(email)``, which the unique indexes rely on)
was duplicated and could drift. #378 moved the remaining auth-router SQL here
too (login/refresh reads, reset + signup reads/writes). The read helpers only
execute; the writers below do NOT commit — the router owns the transaction
boundary so its commit/rollback stays visible at the call site.

SECURITY: ``columns`` is interpolated into the SQL string, so it MUST only ever
receive a hard-coded, developer-supplied column list — NEVER request/user data.
Every call site in this repo passes a string literal; keep it that way.
"""
from __future__ import annotations

from typing import Any, Mapping, Optional

from sqlalchemy import text
from sqlalchemy.engine import Result
from sqlalchemy.ext.asyncio import AsyncSession


async def get_tenant_by_workspace_code(
    db: AsyncSession, code: str, *, columns: str = "id"
) -> Optional[Mapping[str, Any]]:
    """Resolve a tenant by its (case-insensitive) workspace_code.

    ``columns`` must be a hard-coded literal column list (see module docstring).
    """
    return (await db.execute(
        # `columns` is a hard-coded developer literal, never request/user data
        # (enforced by the module SECURITY contract); value params are bound.
        text(f"SELECT {columns} FROM tenants WHERE upper(workspace_code) = upper(:code)"),  # skipcq: BAN-B608
        {"code": code},
    )).mappings().first()


async def get_user_by_tenant_email(
    db: AsyncSession, tenant_id: Any, email: str, *, columns: str = "id"
) -> Optional[Mapping[str, Any]]:
    """Resolve a user within a tenant by (case-insensitive) email.

    ``columns`` must be a hard-coded literal column list (see module docstring).
    """
    return (await db.execute(
        # `columns` is a hard-coded developer literal, never request/user data
        # (enforced by the module SECURITY contract); value params are bound.
        text(f"SELECT {columns} FROM users WHERE tenant_id = :tid AND lower(email) = lower(:email)"),  # skipcq: BAN-B608
        {"tid": tenant_id, "email": email},
    )).mappings().first()


# ── Login / refresh reads ──────────────────────────────────────────────────

async def get_login_row(
    db: AsyncSession, *, workspace_code: str, email: str,
) -> Optional[Mapping[str, Any]]:
    """Resolve workspace → tenant AND the (tenant, email) user in ONE round trip.

    A LEFT JOIN anchored on tenants collapses two serial pooler round-trips into
    one while keeping the two distinct "no tenant" vs "no user" branches
    distinguishable (#234). Returns None only when the workspace_code is unknown;
    a known code with an unknown email yields a row whose ``user_id`` is NULL.
    """
    return (await db.execute(
        text("""
            SELECT t.id   AS tenant_id,
                   t.name AS tenant_name,
                   t.seat_limit,
                   u.id   AS user_id,
                   u.email,
                   u.name AS user_name,
                   u.role,
                   u.is_active,
                   u.assigned_city,
                   u.password_hash
              FROM tenants t
              LEFT JOIN users u
                ON u.tenant_id = t.id AND lower(u.email) = lower(:email)
             WHERE upper(t.workspace_code) = upper(:code)
        """),
        {"code": workspace_code, "email": email},
    )).mappings().first()


async def get_primary_membership(db: AsyncSession, user_id: Any) -> Mapping[str, Any]:
    """The user's deterministic primary module membership (or an empty mapping).

    ORDER BY module keeps the chosen module — and therefore the JWT's module
    claim — stable across logins (#124).
    """
    return (await db.execute(
        text("""
            SELECT module, role_in_module, supervisor_id
              FROM user_module_memberships
             WHERE user_id = :uid
             ORDER BY module
             LIMIT 1
        """),
        {"uid": user_id},
    )).mappings().first() or {}


async def get_active_user_for_refresh(db: AsyncSession, user_id: Any) -> Optional[Mapping[str, Any]]:
    """User + tenant row for a refresh, gated on ``is_active = true`` so a
    deactivated/deleted account cannot re-mint a token."""
    return (await db.execute(
        text("""
            SELECT u.id, u.email, u.name, u.role, u.assigned_city,
                   t.id AS tenant_id, t.name AS tenant_name
              FROM users u
              JOIN tenants t ON t.id = u.tenant_id
             WHERE u.id = :uid AND u.is_active = true
        """),
        {"uid": user_id},
    )).mappings().first()


# ── Password-reset reads / writes ──────────────────────────────────────────

async def get_pending_reset_request(
    db: AsyncSession, *, tenant_id: Any, email: str,
) -> Optional[Mapping[str, Any]]:
    """An existing pending reset request for (tenant, email), if any (dedupe)."""
    return (await db.execute(
        text("""SELECT id FROM password_reset_requests
                 WHERE tenant_id = :tid AND lower(email) = lower(:email) AND status = 'pending'"""),
        {"tid": tenant_id, "email": email},
    )).mappings().first()


async def insert_password_reset_request(
    db: AsyncSession, *, tenant_id: Any, user_id: Any, email: str,
) -> None:
    """Enqueue a pending reset request (does not commit)."""
    await db.execute(
        text("""INSERT INTO password_reset_requests (tenant_id, user_id, email)
                VALUES (:tid, :uid, :email)"""),
        {"tid": tenant_id, "uid": user_id, "email": email},
    )


async def get_approved_reset_request(
    db: AsyncSession, *, tenant_id: Any, user_id: Any,
) -> Optional[Mapping[str, Any]]:
    """The newest still-valid approved reset request for a user, if any."""
    return (await db.execute(
        text("""SELECT id, reset_token_hash FROM password_reset_requests
                 WHERE tenant_id = :tid AND user_id = :uid AND status = 'approved'
                   AND (token_expires_at IS NULL OR token_expires_at > now())
                 ORDER BY created_at DESC LIMIT 1"""),
        {"tid": tenant_id, "uid": user_id},
    )).mappings().first()


async def update_user_password(db: AsyncSession, *, user_id: Any, password_hash: str) -> None:
    """Set a user's password_hash unconditionally (does not commit)."""
    await db.execute(
        text("UPDATE users SET password_hash = :h WHERE id = :uid"),
        {"h": password_hash, "uid": user_id},
    )


async def mark_reset_completed(db: AsyncSession, req_id: Any) -> None:
    """Mark a reset request completed (does not commit)."""
    await db.execute(
        text("UPDATE password_reset_requests SET status = 'completed', completed_at = now() WHERE id = :id"),
        {"id": req_id},
    )


async def set_first_password_if_null(
    db: AsyncSession, *, user_id: Any, password_hash: str,
) -> Result:
    """Guarded first-password write — only lands when password_hash IS NULL.

    Returns the Result so the caller can inspect ``rowcount`` and 409 on a lost
    race (never overwrite an existing password). Does not commit.
    """
    return await db.execute(
        text("""UPDATE users SET password_hash = :h
                 WHERE id = :uid AND password_hash IS NULL"""),
        {"h": password_hash, "uid": user_id},
    )


# ── Signup reads / writes ──────────────────────────────────────────────────

async def get_module_code(db: AsyncSession, code: str) -> Optional[Mapping[str, Any]]:
    """A non-revoked supervisor dept_code → (tenant_id, module)."""
    return (await db.execute(
        text("""
            SELECT tenant_id, module
              FROM module_codes
             WHERE code = :code AND revoked_at IS NULL
        """),
        {"code": code},
    )).mappings().first()


async def get_supervisor_invite_code(db: AsyncSession, code: str) -> Optional[Mapping[str, Any]]:
    """A non-revoked executive supervisor_code → (tenant_id, supervisor_id, module)."""
    return (await db.execute(
        text("""
            SELECT tenant_id, supervisor_id, module
              FROM supervisor_invite_codes
             WHERE code = :code AND revoked_at IS NULL
        """),
        {"code": code},
    )).mappings().first()


async def insert_pending_signup(
    db: AsyncSession, *, user_id: Any, tenant_id: Any, role: str, email: str, name: str, notes: str,
) -> None:
    """Insert an inactive pending signup row (does not commit)."""
    await db.execute(
        text("""
            INSERT INTO users (id, tenant_id, role, email, name, is_active, notes)
            VALUES (:id, :tid, :role, :email, :name, false, :notes)
        """),
        {
            "id":    user_id,
            "tid":   tenant_id,
            "role":  role,
            "email": email,
            "name":  name,
            "notes": notes,
        },
    )
