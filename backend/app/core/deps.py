"""FastAPI dependencies: get_db, get_current_user, get_tenant."""
from __future__ import annotations

import logging
from typing import Annotated, Optional

from fastapi import Depends, Header
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import AuthError, decode_token
from app.db.session import get_db


_log = logging.getLogger("matrix.deps")

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
    db: Annotated[AsyncSession, Depends(get_db)],
    authorization: Annotated[Optional[str], Header()] = None,
    x_override_role: Annotated[Optional[str], Header(alias="X-Override-Role")] = None,
    x_override_module: Annotated[Optional[str], Header(alias="X-Override-Module")] = None,
) -> dict:
    """Extract + verify the current user from the Authorization header.

    Production: requires a valid Supabase Bearer token. Missing / invalid
    tokens raise 401.

    Tokens live 24h with role/tenant baked in at login. Claims alone are
    therefore stale (#103): a deactivated or demoted user would keep full
    access until expiry, with no revocation. So every request re-checks
    `users.is_active` and takes the CURRENT role from the DB — flipping
    is_active=false is now an immediate kill switch.

    Local dev: if ALLOW_ANON_DEMO_USER=true and no header is sent, falls back
    to a fixed demo user so the UI can be driven without a real Supabase
    project.
    """
    if not authorization:
        if settings.allow_anon_demo_user:
            # Boot-time validator (#224) already confined this flag to
            # insecure-dev mode; log each time the bypass is actually exercised
            # so an accidental dev-mode deploy is visible in the request logs.
            _log.warning(
                "ALLOW_ANON_DEMO_USER bypass taken — header-less request "
                "authenticated as demo executive on tenant %s",
                _DEMO_USER["tenant_id"],
            )
            return _DEMO_USER
        raise AuthError("Missing Authorization header")

    if not authorization.startswith("Bearer "):
        raise AuthError("Authorization header must use the Bearer scheme")

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise AuthError("Empty bearer token")

    claims = decode_token(token)

    module_to_check = x_override_module or claims.get("module")
    q = """
        SELECT u.role, u.is_active, 
               COALESCE(umm.has_executive_access, false) AS has_executive_access,
               EXISTS(
                 SELECT 1 FROM supervisor_executive_requests req
                 WHERE req.supervisor_id = u.id 
                   AND req.module = :mod 
                   AND req.status = 'pending'
               ) AS has_pending_executive_request
        FROM users u 
        LEFT JOIN user_module_memberships umm ON u.id = umm.user_id AND umm.module = :mod
        WHERE u.id = :uid
    """
    row = (await db.execute(
        text(q),
        {"uid": claims["sub"], "mod": module_to_check},
    )).mappings().first()
    if not row or not row["is_active"]:
        raise AuthError("Account is inactive or no longer exists. Sign in again.")
    
    # Check if the database role is business_admin or if supervisor has executive access.
    # If so, allow headers to override the effective role/module returned to downstream endpoints.
    db_role = row["role"]
    claims["role"] = db_role
    claims["real_role"] = db_role
    claims["has_executive_access"] = row["has_executive_access"]
    claims["has_pending_executive_request"] = row["has_pending_executive_request"]
    if db_role == "business_admin":
        if x_override_role:
            claims["role"] = x_override_role
        if x_override_module:
            claims["module"] = x_override_module
    elif db_role == "supervisor" and row["has_executive_access"]:
        if x_override_role == "executive":
            claims["role"] = "executive"

    # The is_active SELECT above AUTO-BEGAN a transaction on the request-scoped
    # session (SQLAlchemy 2.0 autobegin). If left open, the service-layer
    # transaction() helper sees in_transaction()==True and opens a SAVEPOINT
    # (begin_nested) inside it instead of a real transaction — and releasing a
    # savepoint does NOT commit the outer txn, so EVERY write was silently
    # rolled back when the session closed (regression from adding this
    # per-request check, #103). Release the read-only txn here so the write path
    # opens a real, committing transaction. Rolling back a read discards nothing.
    await db.rollback()
    return claims


CurrentUser = Annotated[dict, Depends(get_current_user)]


async def get_tenant(current_user: CurrentUser) -> str:
    """Extract tenant_id from the current user's claims."""
    return current_user["tenant_id"]


TenantId = Annotated[str, Depends(get_tenant)]
