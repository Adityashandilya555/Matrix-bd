"""FastAPI dependencies: get_db, get_current_user, get_tenant."""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import AuthError, decode_token
from app.db.session import get_db


DbDep = Annotated[AsyncSession, Depends(get_db)]


# Demo user used only when ALLOW_ANON_DEMO_USER=true. Must be off in prod.
_DEMO_USER = {
    "sub": "00000000-0000-0000-0000-000000000001",
    "name": "Riya Sharma (demo)",
    "email": "demo@bluetokai.local",
    "role": "executive",
    "tenant_id": "00000000-0000-0000-0000-000000000099",
    "city": "Mumbai",
}


async def get_current_user(
    authorization: Annotated[Optional[str], Header()] = None,
) -> dict:
    """Extract + verify the current user from the Authorization header.

    Production: requires a valid Supabase Bearer token. Missing / invalid
    tokens raise 401.

    Local dev: if ALLOW_ANON_DEMO_USER=true and no header is sent, falls back
    to a fixed demo user so the UI can be driven without a real Supabase
    project.
    """
    if not authorization:
        if settings.allow_anon_demo_user:
            return _DEMO_USER
        raise AuthError("Missing Authorization header")

    if not authorization.startswith("Bearer "):
        raise AuthError("Authorization header must use the Bearer scheme")

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise AuthError("Empty bearer token")

    return decode_token(token)


CurrentUser = Annotated[dict, Depends(get_current_user)]


async def get_tenant(current_user: CurrentUser) -> str:
    """Extract tenant_id from the current user's claims."""
    return current_user["tenant_id"]


TenantId = Annotated[str, Depends(get_tenant)]
