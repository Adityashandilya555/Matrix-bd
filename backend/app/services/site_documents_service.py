from __future__ import annotations

import asyncio
from uuid import UUID
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import desc, select
from app.db import models
from app.services._common import assert_executive_owns_site, fetch_site_or_404
from app.services.storage_service import signed_url

async def get_site_documents(
    db: AsyncSession,
    *,
    site_id: str | UUID,
    tenant_id: str | UUID,
    current_user: dict,
    limit: int = 100,
) -> dict[str, Any]:
    """Retrieve all files/documents attached to a site, signing their storage URLs concurrently."""
    site = await fetch_site_or_404(db, site_id=site_id, tenant_id=tenant_id)
    assert_executive_owns_site(current_user, site)
    
    stmt = (
        select(models.SiteFile)
        .where(models.SiteFile.site_id == site.id)
        .order_by(desc(models.SiteFile.uploaded_at))
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()

    _sem = asyncio.Semaphore(8)

    async def _sign(path: str):
        async with _sem:
            return await signed_url(path)

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
        for r, url in zip(rows, urls)
    ]
    return {"site_id": str(site_id), "documents": items}
