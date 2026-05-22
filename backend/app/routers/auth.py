"""Auth router.

With Supabase the login flow happens entirely on the client (the Supabase JS
SDK trades email+password for an access_token against the GoTrue endpoint).
Our backend NEVER sees the password — it only verifies the resulting JWT on
incoming requests (see `app.core.security.decode_token`).

This router therefore exposes only:
    GET  /auth/whoami  — echoes the decoded JWT claims (for client debugging)
    POST /auth/logout  — a thin courtesy endpoint; the real session lifetime
                         is controlled by Supabase. Clients should ALSO call
                         `supabase.auth.signOut()` to clear the local token.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.core.deps import CurrentUser
from app.domain.schemas.common import OkResponse

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.get("/whoami", summary="Return the decoded session claims")
async def whoami(current_user: CurrentUser) -> dict:
    return current_user


@router.post(
    "/logout",
    response_model=OkResponse,
    summary="Courtesy logout (clients must also call supabase.auth.signOut)",
)
async def logout() -> OkResponse:
    return OkResponse(ok=True, message="Logged out. Discard your bearer token.")
