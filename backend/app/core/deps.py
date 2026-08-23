"""FastAPI dependencies: get_db, get_current_user, get_tenant."""
from __future__ import annotations

import logging
from typing import Annotated, Optional

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import AuthError, decode_token
from app.rbac.roles import Role
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


# HTTP methods an observer may use. OPTIONS is included so CORS preflight is
# never refused; HEAD because it is a GET without a body.
_READ_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


# Roles an observer may present as while reading a module. Deliberately NOT
# business_admin: services/_common.py's actor_is_business_admin() accepts either
# `real_role` OR `role`, so admitting it here would let an observer satisfy an
# admin-tier check on any read path. Supervisor and executive are the two the
# Workspace Access panel offers, and neither is an escalation — an observer
# already reads everything through the guard bypasses; this only decides which
# shape a module page renders in.
_OBSERVER_OVERRIDE_ROLES = frozenset({Role.SUPERVISOR.value, Role.EXECUTIVE.value})


def _assert_may_write(claims: dict, request: Request) -> None:
    """Refuse any state-changing request from a read-only `observer`.

    Enforced here because every one of the 106 tenant-scoped mutating routes
    reaches get_current_user (via require_role, require_module, CurrentUser or
    TenantId), so this is the only place the rule has to exist. The 16 routes
    that do NOT reach it are pre-session auth or platform-admin-key tenancy
    endpoints — not observer surface. tests/test_observer_readonly.py enumerates
    and asserts exactly that.

    Keyed on real_role, never role: role is rewritten by the X-Override-Role
    header, so an observer viewing a module "as supervisor" would otherwise lift
    its own restriction.

    NOTE for anyone moving this call — it must stay AFTER the db.rollback() in
    get_current_user. The is_active SELECT autobegins a transaction, and raising
    before it is released leaves it open; that is the #103 regression where every
    write was silently rolled back into a savepoint.
    """
    if claims.get("real_role") == Role.OBSERVER.value and request.method not in _READ_METHODS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Observer access is read-only.",
        )


def _apply_workspace_override(
    claims: dict,
    *,
    db_role: str,
    has_executive_access: bool,
    override_role: Optional[str],
    override_module: Optional[str],
) -> None:
    """Rewrite the EFFECTIVE role/module from the X-Override-* headers.

    Three callers may drive another role, each for a different reason:

    * ``business_admin`` — workspace access, unrestricted, the original feature.
    * ``observer`` — read-only module switching. It already reads every module
      through the guard bypasses in rbac/guards.py, so this exists only so a
      module page renders in the shape its own supervisor (or executive) sees,
      rather than whatever shape an unrecognised role falls through to. Setting
      ``module`` is what scopes the module queries at all — an observer's token
      carries no module claim of its own. Its role is allowlisted, never
      business_admin (see _OBSERVER_OVERRIDE_ROLES).
    * a dual-role ``supervisor`` — may drop to executive inside its own module.

    Only ``role`` and ``module`` move here. ``real_role`` is set by the caller
    before this runs and is never touched, which is what keeps _assert_may_write
    (and services/_common.py's actor_is_business_admin) honest.

    Extracted from get_current_user because that function is on every single
    request and this chain pushed it past the complexity gate (PY-R1000).
    """
    if db_role == "business_admin":
        if override_role:
            claims["role"] = override_role
        if override_module:
            claims["module"] = override_module
    elif db_role == Role.OBSERVER.value:
        if override_role in _OBSERVER_OVERRIDE_ROLES:
            claims["role"] = override_role
        if override_module:
            claims["module"] = override_module
    elif db_role == "supervisor" and has_executive_access and override_role == "executive":
        claims["role"] = "executive"


async def get_current_user(
    request: Request,
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

    # Full query including supervisor executive access fields.
    # Falls back to a simpler query if the migration adding
    # supervisor_executive_requests / has_executive_access hasn't been
    # applied yet — prevents 500s during the migration window.
    _FULL_QUERY = """\
        SELECT u.role, u.is_active,
               COALESCE(umm.has_executive_access, false) AS has_executive_access,
               EXISTS(
                 SELECT 1 FROM supervisor_executive_requests req
                 WHERE req.supervisor_id = u.id
                   AND req.tenant_id = :tid
                   AND req.module = :mod
                   AND req.status = 'pending'
               ) AS has_pending_executive_request
        FROM users u
        LEFT JOIN user_module_memberships umm
          ON u.id = umm.user_id
         AND umm.module = :mod
         AND umm.tenant_id = :tid
        WHERE u.id = :uid
        -- An executive can hold several membership rows in one module (one per
        -- supervisor, migration 20260818), so this LEFT JOIN can match more than
        -- once and .first() would pick arbitrarily. has_executive_access is a
        -- supervisor flag and false on every executive row, so nothing moves
        -- today — but order it so the permissive row always wins rather than
        -- whichever the planner happened to emit.
        ORDER BY COALESCE(umm.has_executive_access, false) DESC
        LIMIT 1
    """
    params = {"uid": claims["sub"], "mod": module_to_check, "tid": claims["tenant_id"]}
    # The migration adding supervisor_executive_requests / has_executive_access
    # landed long ago (the ledger runner guarantees migrations on boot), so the
    # old try/except fallback only masked genuine DB errors behind a warning +
    # second query. Removed (#373) — a real failure now surfaces to the caller.
    row = (await db.execute(text(_FULL_QUERY), params)).mappings().first()

    if not row or not row["is_active"]:
        raise AuthError("Account is inactive or no longer exists. Sign in again.")

    db_role = row["role"]
    claims["role"] = db_role
    claims["real_role"] = db_role
    claims["has_executive_access"] = row.get("has_executive_access", False)
    claims["has_pending_executive_request"] = row.get("has_pending_executive_request", False)
    _apply_workspace_override(
        claims,
        db_role=db_role,
        has_executive_access=bool(row.get("has_executive_access")),
        override_role=x_override_role,
        override_module=x_override_module,
    )

    # The is_active SELECT above AUTO-BEGAN a transaction on the request-scoped
    # session (SQLAlchemy 2.0 autobegin). If left open, the service-layer
    # transaction() helper sees in_transaction()==True and opens a SAVEPOINT
    # (begin_nested) inside it instead of a real transaction — and releasing a
    # savepoint does NOT commit the outer txn, so EVERY write was silently
    # rolled back when the session closed (regression from adding this
    # per-request check, #103). Release the read-only txn here so the write path
    # opens a real, committing transaction. Rolling back a read discards nothing.
    await db.rollback()

    _assert_may_write(claims, request)

    return claims


CurrentUser = Annotated[dict, Depends(get_current_user)]


async def get_tenant(current_user: CurrentUser) -> str:
    """Extract tenant_id from the current user's claims."""
    return current_user["tenant_id"]


TenantId = Annotated[str, Depends(get_tenant)]
