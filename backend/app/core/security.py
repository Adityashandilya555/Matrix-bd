"""Supabase JWT verification.

Supabase issues HS256-signed JWTs by default. The "JWT secret" lives in
*Project Settings → API* and is shared between the GoTrue auth service and
your backend; verify with it directly.

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

from typing import Any

import jwt
from fastapi import HTTPException, status

from app.core.config import settings


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
          "role":      <executive | supervisor | sub_supervisor | system>,
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
    }
