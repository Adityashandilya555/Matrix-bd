"""Photo service — upload site photos to Supabase Storage."""
from __future__ import annotations

import uuid as _uuid
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.db.session import transaction
from app.services._common import fetch_site_or_404
from app.services.audit_service import write_audit_event
from app.services.storage_service import delete_object, safe_object_name, signed_url, upload_bytes


async def _phase_file_count(session: AsyncSession, *, site_id, tenant_id, file_type: str) -> int:
    return (await session.execute(
        select(func.count()).select_from(models.SiteFile).where(
            models.SiteFile.site_id == site_id,
            models.SiteFile.tenant_id == tenant_id,
            models.SiteFile.file_type == file_type,
        )
    )).scalar_one()


async def svc_upload_site_file(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    filename: str,
    content_type: Optional[str],
    file_bytes: bytes,
    file_type: str = "photo",
    path_prefix: str = "photos",
    audit_action: str = "upload_photo",
    max_count: Optional[int] = None,
    delegation_modules: Optional[tuple[str, ...]] = None,
) -> dict:
    """Upload a file to Supabase Storage and persist a ``site_files`` row.

    Generic over ``file_type`` / ``path_prefix`` / ``audit_action`` so the same
    ownership check, connection-release (#89) and audit flow are reused by both
    site photos (``photo``) and project-excellence attachments (``excellence``).

    Returns a dict with ``id``, ``url`` (signed), ``file_name``,
    ``file_size_kb``, and ``mime_type`` so the frontend can immediately
    replace its local blob URL with the persisted signed URL.

    Any authenticated executive (owning the site, or holding an active
    delegation in one of ``delegation_modules``) or supervisor/business_admin
    may upload — there is no site-status restriction. ``max_count`` caps how
    many rows of ``file_type`` a site may hold (409 beyond it).
    """
    # Validate tenant + executive ownership (#104) BEFORE the storage write so
    # a non-owner can't even litter the bucket. Capture what we need, then end
    # the read txn so the slow upload doesn't pin a pgBouncer slot (#89).
    from app.services.site_documents_service import assert_site_doc_access

    site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
    await assert_site_doc_access(session, actor=actor, site=site, delegation_modules=delegation_modules)
    if max_count is not None:
        # Fast-fail before the slow upload. NOT authoritative on its own — the
        # in-transaction recheck below (under an advisory lock) is what actually
        # enforces the cap against a two-tab/retry race.
        if await _phase_file_count(session, site_id=site.id, tenant_id=site.tenant_id, file_type=file_type) >= max_count:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail="An attachment already exists for this phase — remove it first.",
            )
    site_pk = site.id
    tenant_pk = site.tenant_id
    await session.rollback()

    file_id = _uuid.uuid4()
    # Prefix the filename with a short random hex to avoid collisions when the
    # same filename is uploaded twice for the same site. Sanitise the name for
    # the storage key (Supabase rejects non-ASCII keys like macOS screenshot
    # names with a U+202F → 400); the original `filename` is kept for display.
    safe_name = f"{file_id.hex[:8]}_{safe_object_name(filename)}"
    storage_path = f"{path_prefix}/{tenant_id}/{site_pk}/{safe_name}"

    # Upload outside the transaction — if storage fails the transaction never opens.
    await upload_bytes(
        path=storage_path,
        body=file_bytes,
        content_type=content_type or "image/jpeg",
    )

    try:
        async with transaction(session):
            if max_count is not None:
                # Serialize concurrent uploads for this (site, phase) so the
                # recheck is authoritative — there is no unique index, and two
                # tabs could both clear the fast-fail above before either row
                # is committed. The xact lock releases at commit/rollback and is
                # pgBouncer-transaction-pooler safe.
                #
                # hashtext() is int4, so two unrelated (site, phase) keys can
                # collide and briefly serialize against each other. That costs a
                # little throughput on a rare coincidence and never correctness
                # — a collision only ever over-serializes, never under-.
                await session.execute(
                    text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
                    {"k": f"{site_pk}:{file_type}"},
                )
                if await _phase_file_count(session, site_id=site_pk, tenant_id=tenant_pk, file_type=file_type) >= max_count:
                    raise HTTPException(
                        status_code=http_status.HTTP_409_CONFLICT,
                        detail="An attachment already exists for this phase — remove it first.",
                    )
            session.add(models.SiteFile(
                id=file_id,
                tenant_id=tenant_id,
                site_id=site_pk,
                uploaded_by=actor["sub"],
                file_type=file_type,
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
                action=audit_action,
                detail=filename,
            )
    except Exception:
        # The object is already in the bucket by this point, so ANY failure
        # below the upload leaves it dangling — a lost max_count race (409), but
        # equally a constraint violation or a dropped connection during the
        # insert. Catching only HTTPException would have orphaned the object on
        # exactly the failures we cannot retry. delete_object never raises, so
        # this cannot mask the original error. Purge, then re-raise unchanged.
        await delete_object(path=storage_path)
        raise

    url = await signed_url(storage_path)
    return {
        "id": str(file_id),
        "url": url,
        "file_name": filename,
        "file_size_kb": max(1, len(file_bytes) // 1024),
        "mime_type": content_type,
    }


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
    """Upload a site photo (``file_type='photo'``). Thin wrapper kept for the
    existing ``POST /sites/{id}/photos`` call site."""
    return await svc_upload_site_file(
        session, tenant_id=tenant_id, actor=actor, site_id=site_id,
        filename=filename, content_type=content_type, file_bytes=file_bytes,
    )
