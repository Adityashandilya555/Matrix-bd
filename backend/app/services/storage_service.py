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

import logging
import re
import unicodedata

import httpx
from fastapi import HTTPException, status

from app.core.config import settings

logger = logging.getLogger(__name__)


def safe_object_name(filename: str, *, fallback: str = "file") -> str:
    """Sanitise a user filename into a Supabase-Storage-safe object-key segment.

    Supabase Storage rejects object keys containing non-ASCII / control / odd
    whitespace characters with a 400 — notably the U+202F narrow no-break space
    macOS embeds in screenshot names ("…12.14.54 PM.png"), which surfaced as a
    failed photo upload (400 → 502). We normalise to ASCII and keep only
    [A-Za-z0-9._-]; the original name is preserved separately for display (the
    `file_name` column), so only the storage key is affected.
    """
    ascii_name = (
        unicodedata.normalize("NFKD", filename or "")
        .encode("ascii", "ignore")
        .decode("ascii")
    )
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", ascii_name).strip("._")
    return cleaned or fallback


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
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.put(
                url,
                content=body,
                headers=_auth_headers({"Content-Type": content_type, "x-upsert": "true"}),
            )
    except httpx.HTTPError as exc:
        # Network timeout / DNS failure / connection reset — would otherwise be
        # an unhandled 500 (CORS-masked "Network Error") (#92).
        logger.warning("storage upload transport error for %s: %s", path, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Storage upload failed: storage service unreachable.",
        ) from exc
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
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(url, json={"expiresIn": expires_in}, headers=_auth_headers())
        if r.status_code >= 300:
            return None
        signed_path = r.json().get("signedURL")
    except (httpx.HTTPError, ValueError) as exc:
        # ValueError covers JSONDecodeError when a 2xx body isn't JSON (a gateway
        # error page). Degrade to no-url instead of 500-ing the whole response so
        # a transient storage hiccup doesn't break list/view endpoints (#92).
        logger.warning("could not sign url for %s: %s", path, exc)
        return None
    return f"{settings.supabase_project_url.rstrip('/')}/storage/v1{signed_path}" if signed_path else None
