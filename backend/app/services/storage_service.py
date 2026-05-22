"""Supabase Storage adapter (server-side, service-role key).

Provides:
    upload_bytes(path, body, content_type) -> None
    signed_url(path, expires_in=300) -> str

We use httpx against the Supabase Storage REST API rather than the supabase-py
SDK to keep the dependency footprint small. The service role key is sent as
both `apikey` and `Authorization: Bearer …`, per Supabase docs.

Behaviour without config:
- If `SUPABASE_PROJECT_URL` or `SUPABASE_SERVICE_ROLE_KEY` is empty,
  `upload_bytes` raises HTTP 503 so the route fails fast rather than silently
  succeeding. `signed_url` returns `None`.
"""
from __future__ import annotations

import httpx
from fastapi import HTTPException, status

from app.core.config import settings


def _storage_base() -> str:
    return f"{settings.supabase_project_url.rstrip('/')}/storage/v1"


def _require_storage_config() -> None:
    if not settings.supabase_project_url or not settings.supabase_service_role_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase Storage not configured (SUPABASE_PROJECT_URL / SUPABASE_SERVICE_ROLE_KEY missing).",
        )


def _auth_headers(extra: dict | None = None) -> dict:
    h = {
        "apikey": settings.supabase_service_role_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
    }
    if extra:
        h.update(extra)
    return h


async def upload_bytes(*, path: str, body: bytes, content_type: str) -> None:
    """PUT raw bytes into the configured bucket at `path`. Overwrites."""
    _require_storage_config()
    url = f"{_storage_base()}/object/{settings.supabase_storage_bucket}/{path}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.put(
            url,
            content=body,
            headers=_auth_headers({"Content-Type": content_type, "x-upsert": "true"}),
        )
    if r.status_code >= 300:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Storage upload failed: {r.status_code} {r.text}",
        )


async def signed_url(path: str, *, expires_in: int = 300) -> str | None:
    """Return a short-lived signed URL for downloading the object."""
    if not settings.supabase_project_url or not settings.supabase_service_role_key:
        return None
    url = f"{_storage_base()}/object/sign/{settings.supabase_storage_bucket}/{path}"
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(url, json={"expiresIn": expires_in}, headers=_auth_headers())
    if r.status_code >= 300:
        return None
    signed_path = r.json().get("signedURL")
    return f"{settings.supabase_project_url.rstrip('/')}/storage/v1{signed_path}" if signed_path else None
