"""Shared read helpers for the two most common auth primitives (#234, 12.2):
resolve a tenant by workspace_code, and resolve a user by (tenant, email).

These lookups were copy-pasted across the auth + tenancy routers, so the
case-folding contract — ``upper(workspace_code)`` and ``lower(email)``, which
the unique indexes rely on — was duplicated and could drift independently.
Centralising them keeps that contract in exactly one place.

SECURITY: ``columns`` is interpolated into the SQL string, so it MUST only ever
receive a hard-coded, developer-supplied column list — NEVER request/user data.
Every call site in this repo passes a string literal; keep it that way.
"""
from __future__ import annotations

from typing import Any, Mapping, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def get_tenant_by_workspace_code(
    db: AsyncSession, code: str, *, columns: str = "id"
) -> Optional[Mapping[str, Any]]:
    """Resolve a tenant by its (case-insensitive) workspace_code.

    ``columns`` must be a hard-coded literal column list (see module docstring).
    """
    return (await db.execute(
        text(f"SELECT {columns} FROM tenants WHERE upper(workspace_code) = upper(:code)"),
        {"code": code},
    )).mappings().first()


async def get_user_by_tenant_email(
    db: AsyncSession, tenant_id: Any, email: str, *, columns: str = "id"
) -> Optional[Mapping[str, Any]]:
    """Resolve a user within a tenant by (case-insensitive) email.

    ``columns`` must be a hard-coded literal column list (see module docstring).
    """
    return (await db.execute(
        text(f"SELECT {columns} FROM users WHERE tenant_id = :tid AND lower(email) = lower(:email)"),
        {"tid": tenant_id, "email": email},
    )).mappings().first()
