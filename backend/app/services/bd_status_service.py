"""BD-facing read-only view of legal/licensing status for one site.

Mirrors the data shown to the legal team in LegalReviewResponse, plus the
open change requests for the same site. The licensing block is intentionally
omitted unless the DD final_verdict == 'positive' — BD should only see the
next-step checklist once Due Diligence has cleared.
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.domain.schemas.bd_status import (
    BdSiteStatusResponse,
    DdFailedListResponse,
    DdFailedSiteItem,
)
from app.domain.schemas.legal_change_request import ChangeRequestResponse
from app.domain.state_machine import SiteStatus
from app.services._common import apply_role_scope, fetch_site_or_404, fetch_user_name, fetch_user_names
from app.services.change_request_service import svc_list_for_site
from app.services.legal_service import (
    _batch_dd_by_site,
    _fetch_agreement_or_none,
    _fetch_dd_or_none,
    _fetch_licensing_or_none,
    _agreement_to_response,
    _dd_to_response,
    _licensing_to_response,
)


async def svc_bd_site_status(
    session: AsyncSession, *, site_id: str | UUID, tenant_id: str | UUID,
) -> BdSiteStatusResponse:
    site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)

    dd  = await _fetch_dd_or_none(session, site_id=site.id)
    ag  = await _fetch_agreement_or_none(session, site_id=site.id)
    lic = await _fetch_licensing_or_none(session, site_id=site.id)

    licensing_response = None
    if dd is not None and dd.final_verdict == "positive" and lic is not None:
        licensing_response = _licensing_to_response(lic)

    submitted_by_name = await fetch_user_name(session, site.submitted_by)

    crs = await svc_list_for_site(session, tenant_id=tenant_id, site_id=site.id)

    return BdSiteStatusResponse(
        site_id=str(site.id),
        site_code=site.code or "",
        site_name=site.name,
        city=site.city,
        site_status=site.status,
        legal_dd_status=site.legal_dd_status,
        agreement_status=site.agreement_status,
        licensing_status=site.licensing_status,
        dd=_dd_to_response(dd) if dd else None,
        agreement=_agreement_to_response(ag) if ag else None,
        licensing=licensing_response,
        submitted_by=str(site.submitted_by),
        submitted_by_name=submitted_by_name,
        change_requests=crs.items,
    )


async def svc_bd_dd_failed_queue(
    session: AsyncSession, *, tenant_id: str | UUID, user: Optional[dict] = None,
) -> DdFailedListResponse:
    """Sites whose legal team finalized DD as 'negative' (LEGAL_REJECTED).

    Surfaced as a separate BD tab so failures stand out and aren't lost in
    the noise of the main pipeline. Executives only see their own sites
    (submitted_by / assigned_to); supervisors (or user=None) see all.
    """
    stmt = (
        select(models.Site)
        .where(
            models.Site.tenant_id == tenant_id,
            models.Site.status == SiteStatus.LEGAL_REJECTED.value,
        )
        .order_by(models.Site.legal_rejected_at.desc().nulls_last())
    )
    if user is not None:
        stmt = apply_role_scope(stmt, model=models.Site, user=user)
    sites = (await session.execute(stmt)).scalars().all()

    # Batch DD checklists + submitter names (2 queries total) instead of 2 per
    # site (#91).
    dd_by_site = await _batch_dd_by_site(session, [s.id for s in sites])
    names = await fetch_user_names(session, [s.submitted_by for s in sites])
    items: list[DdFailedSiteItem] = []
    for site in sites:
        dd = dd_by_site.get(site.id)
        submitted_by_name = names.get(site.submitted_by)
        items.append(DdFailedSiteItem(
            site_id=str(site.id),
            site_code=site.code or "",
            site_name=site.name,
            city=site.city,
            submitted_by_name=submitted_by_name,
            rejection_reason=dd.rejection_reason if dd else None,
            legal_rejected_at=site.legal_rejected_at,
        ))

    return DdFailedListResponse(items=items, total=len(items))
