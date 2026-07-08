"""JWT verification + issuance.

We sign and verify HS256 JWTs with the Supabase JWT secret. The same secret
is used by Supabase Auth (if/when we wire it back in), so tokens minted
here are forward-compatible. Today the backend mints its own tokens at
sign-in time (POST /api/auth/login) — no Supabase Auth round-trip needed.

Claims of interest:
    sub:               the Supabase user id (UUID) — maps to users.id
    email:             the user's email
    aud:               'authenticated' for signed-in users
    role:              the *Postgres* role (usually 'authenticated'); the
                       *application* role lives in app_metadata.role
    app_metadata:      server-controlled metadata (where we stash role +
                       tenant_id + city, set via the Supabase admin API)
    user_metadata:     user-editable (don't trust for authz)

Notes:
- We do NOT make a network call per request. The shared secret is enough.
- Tokens past expiry raise 401. Tokens missing app_metadata.tenant_id raise
  403 (you have a Supabase login but no platform tenancy provisioned yet).
"""
from __future__ import annotations

import datetime as dt
from typing import Any, Optional

import jwt
from fastapi import HTTPException, status

from app.core.config import settings


# How long an issued access token stays valid. 24h is a reasonable default for
# an internal ops tool — strikes a balance between UX (no re-login every hour)
# and blast radius (lost laptops eventually lock themselves out).
TOKEN_TTL_SECONDS = 60 * 60 * 24  # 24 hours

# Platform-admin portal tokens are intentionally short-lived (#312).
# Previously the admin password itself was echoed back as a static bearer
# token — capturing it once gave permanent admin access with no expiry or
# rotation. Now we mint a proper JWT with a 30-minute window.
ADMIN_TOKEN_TTL_SECONDS = 60 * 30  # 30 minutes


def issue_admin_token(*, email: str) -> str:
    """Mint a short-lived HS256 JWT for the platform-admin portal.

    The token carries ``aud: "platform-admin"`` so it cannot be confused with
    a regular user token (which has ``aud: "authenticated"``).  Verification
    uses :func:`decode_admin_token`.
    """
    now = dt.datetime.now(tz=dt.timezone.utc)
    claims = {
        "sub":   "platform-admin",
        "aud":   "platform-admin",
        "iat":   int(now.timestamp()),
        "exp":   int((now + dt.timedelta(seconds=ADMIN_TOKEN_TTL_SECONDS)).timestamp()),
        "email": email,
    }
    # Re-use the Supabase JWT secret — avoids a new env var. The distinct
    # audience ("platform-admin" vs "authenticated") prevents cross-use.
    return jwt.encode(claims, settings.supabase_jwt_secret, algorithm="HS256")


def decode_admin_token(token: str) -> dict[str, Any]:
    """Verify a platform-admin JWT issued by :func:`issue_admin_token`.

    Returns ``{"email": ...}`` on success; raises 401 on any failure.
    """
    try:
        claims = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="platform-admin",
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        raise AuthError("Admin session expired — please log in again.")
    except jwt.PyJWTError as exc:
        raise AuthError(f"Invalid admin token: {exc}")
    return {"email": claims.get("email", "")}


def issue_token(
    *,
    sub: str,
    email: str,
    name: str,
    role: str,
    tenant_id: str,
    city: Optional[str] = None,
    module: Optional[str] = None,
    module_role: Optional[str] = None,
    supervisor_id: Optional[str] = None,
    ttl_seconds: int = TOKEN_TTL_SECONDS,
) -> str:
    """Mint an HS256 JWT with the claim shape `decode_token` expects.

    Mirrors Supabase's app_metadata structure exactly so the decode path
    doesn't care whether the token came from us or from Supabase Auth.
    """
    now = dt.datetime.now(tz=dt.timezone.utc)
    app_md: dict[str, Any] = {
        "role":      role,
        "tenant_id": tenant_id,
        "city":      city,
    }
    if module is not None:
        app_md["module"] = module
    if module_role is not None:
        app_md["module_role"] = module_role
    if supervisor_id is not None:
        app_md["supervisor_id"] = supervisor_id
    claims = {
        "sub":   sub,
        "aud":   settings.supabase_jwt_audience,
        "iat":   int(now.timestamp()),
        "exp":   int((now + dt.timedelta(seconds=ttl_seconds)).timestamp()),
        "email": email,
        "app_metadata": app_md,
        "user_metadata": {"full_name": name},
    }
    return jwt.encode(claims, settings.supabase_jwt_secret, algorithm="HS256")


class AuthError(HTTPException):
    def __init__(self, detail: str, code: int = status.HTTP_401_UNAUTHORIZED) -> None:
        super().__init__(status_code=code, detail=detail, headers={"WWW-Authenticate": "Bearer"})


def decode_token(token: str) -> dict[str, Any]:
    """Decode + verify a Supabase-issued JWT.

    Returns the canonical claim shape consumed by `app.core.deps.get_current_user`:
        {
          "sub":       <uuid string>,
          "name":      <display name from user_metadata.full_name or email>,
          "email":     <email>,
          "role":      <business_admin | supervisor | executive | system>,
          "tenant_id": <uuid string>,
          "city":      <city slug or None>,
        }
    """
    try:
        claims = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience=settings.supabase_jwt_audience,
            options={"require": ["exp", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        raise AuthError("Token has expired")
    except jwt.InvalidAudienceError:
        raise AuthError("Token audience mismatch")
    except jwt.PyJWTError as exc:
        raise AuthError(f"Invalid token: {exc}")

    return _session_from_claims(claims)


def _session_from_claims(claims: dict[str, Any]) -> dict[str, Any]:
    """Project already-verified JWT claims into the canonical session dict
    consumed by ``app.core.deps.get_current_user``. Raises 403 if the token is
    structurally valid but missing the app_metadata role/tenant we require."""
    app_md = claims.get("app_metadata") or {}
    user_md = claims.get("user_metadata") or {}

    role = app_md.get("role")
    if not role:
        raise AuthError("Token missing app_metadata.role", code=status.HTTP_403_FORBIDDEN)
    tenant_id = app_md.get("tenant_id")
    if not tenant_id:
        raise AuthError("Token missing app_metadata.tenant_id", code=status.HTTP_403_FORBIDDEN)

    return {
        "sub": claims["sub"],
        "email": claims.get("email"),
        "name": user_md.get("full_name") or claims.get("email") or "unknown",
        "role": role,
        "tenant_id": tenant_id,
        "city": app_md.get("city"),
        "module": app_md.get("module"),
        "module_role": app_md.get("module_role"),
        "supervisor_id": app_md.get("supervisor_id"),
    }


# Bounded grace window during which a lapsed token can be exchanged at POST /auth/refresh.
# All signatures and claims are verified; deactivated accounts cannot refresh.
REFRESH_GRACE_SECONDS = 60 * 60 * 24 * 2  # 48 hours


def decode_token_for_refresh(token: str) -> dict[str, Any]:
    """Decode a bearer token for POST /auth/refresh ONLY.

    Identical verification to :func:`decode_token` (signature, audience and the
    required ``exp``/``sub`` claims) EXCEPT it tolerates a token whose ``exp`` is
    in the past by up to :data:`REFRESH_GRACE_SECONDS`, so a recently-lapsed
    session can be silently re-minted. A token expired beyond the grace window —
    or otherwise invalid — is rejected with 401, exactly like ``decode_token``.
    """
    try:
        claims = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience=settings.supabase_jwt_audience,
            # verify_exp is relaxed; we enforce a bounded grace window manually
            # below. signature + audience + the require list are still checked.
            options={"require": ["exp", "sub"], "verify_exp": False},
        )
    except jwt.InvalidAudienceError:
        raise AuthError("Token audience mismatch")
    except jwt.PyJWTError as exc:
        raise AuthError(f"Invalid token: {exc}")

    exp = claims.get("exp")
    if exp is None:
        raise AuthError("Token missing expiry claim")
    now_ts = int(dt.datetime.now(tz=dt.timezone.utc).timestamp())
    if now_ts - int(exp) > REFRESH_GRACE_SECONDS:
        raise AuthError("Session expired. Please sign in again.")

    return _session_from_claims(claims)
