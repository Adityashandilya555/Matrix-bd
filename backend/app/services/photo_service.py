"""Photo service — upload site photos to Supabase Storage."""
from __future__ import annotations

import uuid as _uuid
from typing import Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.db.session import transaction
from app.services._common import fetch_site_or_404
from app.services.audit_service import write_audit_event
from app.services.storage_service import signed_url, upload_bytes


async def svc_upload_photo(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    filename: str,
    content_type: Optional[str],
    file_bytes: bytes,
) -> dict:
    """Upload a site photo to Supabase Storage and persist a site_files row.

    Returns a dict with ``id``, ``url`` (signed), ``file_name``,
    ``file_size_kb``, and ``mime_type`` so the frontend can immediately
    replace its local blob URL with the persisted signed URL.

    Any authenticated executive or supervisor may upload photos — there is no
    site-status restriction (photos can be attached from DRAFT onwards).
    """
    file_id = _uuid.uuid4()
    # Prefix the filename with a short random hex to avoid collisions when the
    # same filename is uploaded twice for the same site.
    safe_name = f"{file_id.hex[:8]}_{filename}"
    storage_path = f"photos/{tenant_id}/{site_id}/{safe_name}"

    # Upload first — if storage fails the transaction never opens.
    await upload_bytes(
        path=storage_path,
        body=file_bytes,
        content_type=content_type or "image/jpeg",
    )

    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)

        session.add(models.SiteFile(
            id=file_id,
            tenant_id=tenant_id,
            site_id=site.id,
            uploaded_by=actor["sub"],
            file_type="photo",
            file_name=filename,
            storage_path=storage_path,
            file_size_kb=max(1, len(file_bytes) // 1024),
            mime_type=content_type,
            is_primary=False,
            source="manual_upload",
        ))

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="upload_photo",
            detail=filename,
        )

    url = await signed_url(storage_path)
    return {
        "id": str(file_id),
        "url": url,
        "file_name": filename,
        "file_size_kb": max(1, len(file_bytes) // 1024),
        "mime_type": content_type,
    }
