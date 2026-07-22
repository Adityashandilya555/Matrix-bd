from __future__ import annotations

import asyncio
import uuid as _uuid
from uuid import UUID
from typing import Any
from fastapi import HTTPException, status as http_status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, desc, select
from app.db import models
from app.db.session import transaction
from app.services._common import assert_executive_owns_site, fetch_site_or_404
from app.services import storage_service
from app.services.audit_service import write_audit_event
from app.services.delegation_service import svc_is_delegated


async def assert_site_doc_access(
    db: AsyncSession,
    *,
    actor: dict,
    site: models.Site,
    delegation_modules: tuple[str, ...] | None = None,
) -> None:
    """Executive gate for site documents.

    Pass on site ownership (``submitted_by`` / ``assigned_to``); failing that,
    on an active SiteDelegation in any of ``delegation_modules``. PE/FC
    executives typically hold their sites via delegation, not assignment, so
    the plain ownership check alone 403s them out of the attachments they are
    supposed to manage. Supervisors/business_admins pass through unchanged.
    """
    try:
        assert_executive_owns_site(actor, site)
        return
    except HTTPException:
        if not delegation_modules:
            raise
        for module in delegation_modules:
            if await svc_is_delegated(
                db, tenant_id=site.tenant_id, site_id=site.id,
                user_id=actor["sub"], module=module,
            ):
                return
        raise


async def get_site_documents(
    db: AsyncSession,
    *,
    site_id: str | UUID,
    tenant_id: str | UUID,
    current_user: dict,
    limit: int = 100,
    file_type: str | None = None,
    delegation_modules: tuple[str, ...] | None = None,
) -> dict[str, Any]:
    """Retrieve files/documents attached to a site, signing their storage URLs concurrently.

    Pass ``file_type`` (e.g. ``'excellence'``) to return only that category.
    ``delegation_modules`` lets a delegated (not assigned) executive read them.
    """
    site = await fetch_site_or_404(db, site_id=site_id, tenant_id=tenant_id)
    await assert_site_doc_access(db, actor=current_user, site=site, delegation_modules=delegation_modules)

    stmt = select(models.SiteFile).where(models.SiteFile.site_id == site.id)
    if file_type is not None:
        stmt = stmt.where(models.SiteFile.file_type == file_type)
    stmt = stmt.order_by(desc(models.SiteFile.uploaded_at)).limit(limit)
    rows = (await db.execute(stmt)).scalars().all()

    _sem = asyncio.Semaphore(8)

    async def _sign(path: str):
        async with _sem:
            # Late-bind via the module so test monkeypatches of
            # storage_service.signed_url are always observed regardless of
            # import order (a by-value import bound at module-load time is not).
            return await storage_service.signed_url(path)

    urls = await asyncio.gather(*[_sign(r.storage_path) for r in rows])
    items = [
        {
            "id": str(r.id),
            "file_name": r.file_name,
            "file_type": r.file_type,
            "file_size_kb": r.file_size_kb,
            "mime_type": r.mime_type,
            "uploaded_at": r.uploaded_at.isoformat(),
            "uploaded_by": str(r.uploaded_by),
            "url": url,
        }
        for r, url in zip(rows, urls, strict=False)
    ]
    return {"site_id": str(site_id), "documents": items}


async def svc_delete_site_document(
    db: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    file_id: str | UUID,
    allowed_types: tuple[str, ...] = ("excellence", "closure"),
    delegation_modules: tuple[str, ...] | None = None,
) -> dict[str, Any]:
    """Delete one site attachment (row first, then best-effort storage object).

    Scoped to ``allowed_types`` so this endpoint can never delete LOIs, site
    photos, or QA reports. 404 (not 403) on a wrong-tenant/unknown/foreign-type
    id, matching the repo's don't-reveal-existence convention.
    """
    site = await fetch_site_or_404(db, site_id=site_id, tenant_id=tenant_id)
    await assert_site_doc_access(db, actor=actor, site=site, delegation_modules=delegation_modules)

    try:
        file_pk = _uuid.UUID(str(file_id))
    except ValueError:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Attachment not found") from None

    row = (await db.execute(
        select(models.SiteFile).where(
            models.SiteFile.id == file_pk,
            models.SiteFile.site_id == site.id,
            models.SiteFile.tenant_id == site.tenant_id,
            models.SiteFile.file_type.in_(allowed_types),
        )
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Attachment not found")

    storage_path, file_name, file_type = row.storage_path, row.file_name, row.file_type
    async with transaction(db):
        # Statement-form delete (budget_service precedent) — plays well with
        # both AsyncSession and the tests' RecordingSession.
        await db.execute(delete(models.SiteFile).where(models.SiteFile.id == row.id))
        await write_audit_event(
            db, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action=f"delete_{file_type}_doc",
            detail=file_name,
        )
    # After commit: best-effort storage cleanup — the DB row is the source of
    # truth, an orphaned object is logged inside delete_object and tolerated.
    await storage_service.delete_object(path=storage_path)
    return {"ok": True, "id": str(file_pk)}
