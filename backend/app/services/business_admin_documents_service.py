"""Aggregate every document uploaded for a site across its whole lifecycle, for
the business-admin site review — available even after the site is closed.

Documents live in two tables:
  * ``site_files``          — LOI, site photos, quality-audit reports
  * ``design_deliverables`` — recce / 2D / 3D design uploads (file_url under design/)

Storage paths are signed concurrently (bounded). There is NO status filter, so a
closed/launched site's documents remain reviewable. Tenant-scoped via
``fetch_site_or_404`` (also validates the site belongs to the admin's tenant).
"""
from __future__ import annotations

import asyncio
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.services import storage_service
from app.services._common import fetch_site_or_404

# Coarse module label per site_files type, for the admin's at-a-glance grouping.
_SITE_FILE_MODULE = {"loi": "BD", "photo": "BD", "quality_audit": "Project"}


async def list_site_documents(
    db: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID,
) -> dict[str, Any]:
    """All uploaded documents for a site (site_files + design deliverables),
    signed, newest first. Works regardless of site status (closed sites included).
    """
    site = await fetch_site_or_404(db, site_id=site_id, tenant_id=tenant_id)

    files = (await db.execute(
        select(models.SiteFile)
        .where(models.SiteFile.site_id == site.id)
        .order_by(desc(models.SiteFile.uploaded_at))
    )).scalars().all()

    deliverables = (await db.execute(
        select(models.DesignDeliverable).where(
            models.DesignDeliverable.site_id == site.id,
            models.DesignDeliverable.file_url.isnot(None),
        )
    )).scalars().all()

    sem = asyncio.Semaphore(8)

    async def _sign(path: Optional[str]) -> Optional[str]:
        if not path:
            return None
        async with sem:
            try:
                # Late-bind via the module so storage_service.signed_url monkeypatches
                # are observed (matches site_documents_service).
                return await storage_service.signed_url(path)
            except Exception:
                return None

    async def _resolve_deliverable(file_url: Optional[str]) -> Optional[str]:
        # Mirror design_service._deliverable_download_url: only paths we wrote
        # under 'design/' are storage objects to sign. A legacy free-text file_url
        # is NOT an object key — signing it would just fail and drop the Open link.
        # Pass through legacy http(s) values as-is so historic design uploads stay
        # openable; anything else (non-URL junk) has no usable link.
        if not file_url:
            return None
        if file_url.startswith("design/"):
            return await _sign(file_url)
        if file_url.startswith(("http://", "https://")):
            return file_url
        return None

    file_urls, deliverable_urls = await asyncio.gather(
        asyncio.gather(*[_sign(f.storage_path) for f in files]),
        asyncio.gather(*[_resolve_deliverable(d.file_url) for d in deliverables]),
    )

    items: list[dict[str, Any]] = []
    for f, url in zip(files, file_urls, strict=False):
        items.append({
            "id": str(f.id),
            "file_name": f.file_name,
            "file_type": f.file_type,
            "module": _SITE_FILE_MODULE.get(f.file_type, "BD"),
            "uploaded_at": f.uploaded_at.isoformat() if f.uploaded_at else None,
            "uploaded_by": str(f.uploaded_by) if f.uploaded_by else None,
            "url": url,
        })
    for d, url in zip(deliverables, deliverable_urls, strict=False):
        items.append({
            "id": str(d.id),
            "file_name": d.file_name or f"Design · {d.kind}",
            "file_type": f"design_{d.kind}",
            "module": "Design",
            "uploaded_at": d.submitted_at.isoformat() if d.submitted_at else None,
            "uploaded_by": str(d.submitted_by) if d.submitted_by else None,
            "url": url,
        })

    # Newest first across both sources (rows with no timestamp sort last).
    items.sort(key=lambda it: it["uploaded_at"] or "", reverse=True)
    return {"site_id": str(site.id), "documents": items}
