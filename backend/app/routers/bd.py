"""BD (Business Development) router.

Pipeline (drafts), shortlist, detail form, reassignment. Thin alias layer over
`app.services.bd_service`; no SQL or audit logic lives here.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.core.deps import DbDep, TenantId
from app.domain.schemas.common import OkResponse
from app.domain.schemas.site import (
    ApproveShortlistRequest,
    ArchiveSiteRequest,
    CreateDraftRequest,
    ReassignSiteRequest,
    RejectSiteRequest,
    SaveDetailsRequest,
    SiteListResponse,
    SiteResponse,
    SubmitDetailsRequest,
)
from app.domain.schemas.bd_status import BdSiteStatusResponse, DdFailedListResponse
from app.domain.schemas.legal_change_request import (
    ChangeRequestListResponse,
    ChangeRequestResponse,
    CreateChangeRequestRequest,
)
from app.rbac.guards import require_role
from app.rbac.roles import Role
from app.services.bd_service import (
    svc_approve_shortlist,
    svc_archive_site,
    svc_create_draft,
    svc_reassign_site,
    svc_reject_site,
    svc_save_details,
    svc_shortlist_draft,
    svc_submit_details,
)
from app.services.bd_status_service import (
    svc_bd_dd_failed_queue,
    svc_bd_site_status,
)
from app.services.change_request_service import (
    svc_create_change_request,
    svc_list_my_requests,
)
from app.services.query_service import list_sites

router = APIRouter(prefix="/bd", tags=["BD"])


# ── Drafts ─────────────────────────────────────────────────────────────────

@router.post("/drafts", response_model=SiteResponse, status_code=status.HTTP_201_CREATED,
             summary="Create a pipeline draft")
async def create_draft(
    body: CreateDraftRequest,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> SiteResponse:
    return await svc_create_draft(
        db, tenant_id=tenant_id, actor=current_user,
        name=body.name, city=body.city, visit_date=body.visit_date,
        model=body.model, spoc_name=body.spoc_name, google_pin=body.google_pin,
        google_maps_url=body.google_maps_url,
        expected_rent=body.expected_rent, rent_type=body.rent_type,
        expected_escalation_pct=body.expected_escalation_pct,
        expected_escalation_years=body.expected_escalation_years,
        expected_revshare_pct=body.expected_revshare_pct,
    )


@router.get("/drafts", response_model=SiteListResponse, summary="List pipeline drafts")
async def list_drafts(
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> SiteListResponse:
    return await list_sites(db, tenant_id=tenant_id, user=current_user, status="draft_submitted")


@router.post("/drafts/{site_id}/shortlist", response_model=SiteResponse, summary="Shortlist a draft")
async def shortlist_draft(
    site_id: str,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> SiteResponse:
    return await svc_shortlist_draft(db, tenant_id=tenant_id, actor=current_user, site_id=site_id)


@router.post("/drafts/{site_id}/reject", response_model=OkResponse, summary="Reject a draft")
async def reject_draft(
    site_id: str,
    body: RejectSiteRequest,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> OkResponse:
    return await svc_reject_site(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
        reasons=body.reasons, comment=body.note,
    )


@router.post("/drafts/{site_id}/archive", response_model=OkResponse, summary="Archive a site")
async def archive_draft(
    site_id: str,
    body: ArchiveSiteRequest,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> OkResponse:
    return await svc_archive_site(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, note=body.note,
    )


# ── Shortlist ──────────────────────────────────────────────────────────────

@router.get("/shortlist", response_model=SiteListResponse, summary="List shortlisted sites")
async def list_shortlist(
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> SiteListResponse:
    # Two statuses; cheaper as two queries unioned in app code (or use the
    # general list endpoint with no status filter; UI filters client-side).
    a = await list_sites(db, tenant_id=tenant_id, user=current_user, status="shortlisted")
    b = await list_sites(db, tenant_id=tenant_id, user=current_user, status="details_submitted")
    return SiteListResponse(items=a.items + b.items, total=a.total + b.total)


@router.post("/shortlist/{site_id}/details/save", response_model=OkResponse,
             summary="Save partial details (draft save)")
async def save_draft_details(
    site_id: str,
    body: SaveDetailsRequest,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.EXECUTIVE))],
    tenant_id: TenantId,
) -> OkResponse:
    return await svc_save_details(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, details=body.model_dump(),
    )


@router.post("/shortlist/{site_id}/submit", response_model=SiteResponse,
             summary="Submit details for supervisor review")
async def submit_details_for_review(
    site_id: str,
    body: SubmitDetailsRequest,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.EXECUTIVE))],
    tenant_id: TenantId,
) -> SiteResponse:
    return await svc_submit_details(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, details=body.model_dump(),
    )


@router.post("/shortlist/{site_id}/approve", response_model=SiteResponse,
             summary="Approve shortlist and set LOI timeline")
async def approve_shortlist(
    site_id: str,
    body: ApproveShortlistRequest,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> SiteResponse:
    return await svc_approve_shortlist(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
        expected_loi_days=body.expected_loi_days,
    )


@router.post("/shortlist/{site_id}/reassign", response_model=OkResponse,
             summary="Reassign site to another exec")
async def reassign_site(
    site_id: str,
    body: ReassignSiteRequest,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> OkResponse:
    return await svc_reassign_site(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
        new_owner_id=body.new_owner_id,
    )


# ── BD-facing legal status view (View status button) ────────────────────────

@router.get(
    "/sites/{site_id}/legal-status",
    response_model=BdSiteStatusResponse,
    summary="BD read-only view of the legal/licensing state for a site",
)
async def bd_site_legal_status(
    site_id: str,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> BdSiteStatusResponse:
    from app.services._common import assert_executive_owns_site, fetch_site_or_404

    # #104 — executives only view the legal-status projection of their own/
    # assigned sites (mirrors GET /sites/{id} and the tracker).
    site = await fetch_site_or_404(db, site_id=site_id, tenant_id=tenant_id)
    assert_executive_owns_site(current_user, site)
    return await svc_bd_site_status(db, site_id=site_id, tenant_id=tenant_id)


@router.get(
    "/dd-failed",
    response_model=DdFailedListResponse,
    summary="Sites whose Due Diligence was rejected by Legal (separate BD tab)",
)
async def bd_dd_failed_queue(
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> DdFailedListResponse:
    return await svc_bd_dd_failed_queue(db, tenant_id=tenant_id, user=current_user)


# ── Change requests opened by BD against legal fields ───────────────────────

@router.post(
    "/change-requests",
    response_model=ChangeRequestResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Open a change request asking Legal to flip a field value",
)
async def create_change_request(
    body: CreateChangeRequestRequest,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> ChangeRequestResponse:
    return await svc_create_change_request(
        db, tenant_id=tenant_id, actor=current_user, body=body,
    )


@router.get(
    "/change-requests/mine",
    response_model=ChangeRequestListResponse,
    summary="List change requests opened by the current user",
)
async def my_change_requests(
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> ChangeRequestListResponse:
    return await svc_list_my_requests(db, tenant_id=tenant_id, actor=current_user)

