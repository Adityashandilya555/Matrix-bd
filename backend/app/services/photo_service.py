"""Photo service — upload site photos to Supabase Storage."""
from __future__ import annotations

import uuid as _uuid
from typing import Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.db.session import transaction
from app.services._common import assert_executive_owns_site, fetch_site_or_404
from app.services.audit_service import write_audit_event
from app.services.storage_service import safe_object_name, signed_url, upload_bytes


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
    # Validate tenant + executive ownership (#104) BEFORE the storage write so
    # a non-owner can't even litter the bucket. Capture what we need, then end
    # the read txn so the slow upload doesn't pin a pgBouncer slot (#89).
    site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
    assert_executive_owns_site(actor, site)
    site_pk = site.id
    await session.rollback()

    file_id = _uuid.uuid4()
    # Prefix the filename with a short random hex to avoid collisions when the
    # same filename is uploaded twice for the same site. Sanitise the name for
    # the storage key (Supabase rejects non-ASCII keys like macOS screenshot
    # names with a U+202F → 400); the original `filename` is kept for display.
    safe_name = f"{file_id.hex[:8]}_{safe_object_name(filename)}"
    storage_path = f"photos/{tenant_id}/{site_pk}/{safe_name}"

    # Upload outside the transaction — if storage fails the transaction never opens.
    await upload_bytes(
        path=storage_path,
        body=file_bytes,
        content_type=content_type or "image/jpeg",
    )

    async with transaction(session):
        session.add(models.SiteFile(
            id=file_id,
            tenant_id=tenant_id,
            site_id=site_pk,
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
            session, tenant_id=tenant_id, site_id=site_pk,
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
