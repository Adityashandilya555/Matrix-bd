from __future__ import annotations

from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db import models
from app.domain.schemas.site_tracker import SiteTrackerResponse
from app.services._common import assert_executive_owns_site, fetch_site_or_404, fetch_user_name
from app.services.legal_service import (
    _agreement_to_response,
    _dd_to_response,
    _fetch_agreement_or_none,
    _fetch_dd_or_none,
    _fetch_licensing_or_none,
    _licensing_to_response,
)

def _is_published(row) -> bool:
    try:
        stage = getattr(row, "stage", "published")
    except Exception:
        stage = "published"
    return stage in (None, "", "published")


def _visible(row, bd_caller: bool) -> bool:
    return row is not None and (not bd_caller or _is_published(row))


def _resolve_project_status(project, site):
    if project:
        return project.project_status, project.current_stage
    if getattr(site, "design_status", None) == "approved":
        return "pending", "budget"
    return None, None


def _format_tracker(tracker, formatter, bd_caller: bool):
    if tracker is not None and _visible(tracker, bd_caller):
        return formatter(tracker)
    return None


async def build_tracker_response(
    db: AsyncSession,
    *,
    site_id: str | UUID,
    tenant_id: str | UUID,
    current_user: dict,
) -> SiteTrackerResponse:
    """Build cross-module tracker response for a site, resolving legal/agreement/licensing status."""
    site = await fetch_site_or_404(db, site_id=site_id, tenant_id=tenant_id)

    caller_module = (current_user.get("module") or "").lower()
    bd_caller = caller_module in ("", "bd")  # default to BD when module missing

    # BD executives only see their own/assigned sites. Non-BD module members
    # keep access as their modules govern visibility through delegation.
    if bd_caller:
        assert_executive_owns_site(current_user, site)

    dd  = await _fetch_dd_or_none(db, site_id=site.id)
    ag  = await _fetch_agreement_or_none(db, site_id=site.id)
    lic = await _fetch_licensing_or_none(db, site_id=site.id)

    dd_resp        = _format_tracker(dd, _dd_to_response, bd_caller)
    agreement_resp = _format_tracker(ag, _agreement_to_response, bd_caller)
    licensing_resp = _format_tracker(lic, _licensing_to_response, bd_caller)

    submitted_by_name = await fetch_user_name(db, site.submitted_by)
    project = (
        await db.execute(select(models.ProjectReview).where(models.ProjectReview.site_id == site.id))
    ).scalar_one_or_none()
    nso = (
        await db.execute(select(models.NsoReview).where(models.NsoReview.site_id == site.id))
    ).scalar_one_or_none()
    launch = (
        await db.execute(select(models.LaunchApproval).where(models.LaunchApproval.site_id == site.id))
    ).scalar_one_or_none()

    project_status, project_current_stage = _resolve_project_status(project, site)

    return SiteTrackerResponse(
        site_id=str(site.id),
        site_code=site.code or "",
        site_name=site.name,
        city=site.city,
        site_status=site.status,
        legal_dd_status=site.legal_dd_status,
        agreement_status=site.agreement_status,
        licensing_status=site.licensing_status,
        design_status=getattr(site, "design_status", "pending") or "pending",
        project_status=project_status,
        project_current_stage=project_current_stage,
        # Budget moved to Project Excellence (site_budgets); not on project_reviews.
        project_budget_status=None,
        nso_status=nso.nso_status if nso else None,
        nso_current_stage=nso.current_stage if nso else None,
        launch_status=launch.status if launch else None,
        is_launched=bool(getattr(site, "is_launched", False)),
        launched_at=getattr(site, "launched_at", None),
        dd=dd_resp,
        agreement=agreement_resp,
        licensing=licensing_resp,
        submitted_by=str(site.submitted_by),
        submitted_by_name=submitted_by_name,
        kyc_verified=bool(getattr(site, "kyc_verified", False)),
        ca_code=getattr(site, "ca_code", None),
        finance_amount=(
            float(site.finance_amount)
            if getattr(site, "finance_amount", None) is not None
            else None
        ),
        finance_status=getattr(site, "finance_status", "pending") or "pending",
    )
