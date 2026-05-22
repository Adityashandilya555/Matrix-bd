"""BD (Business Development) router.

Pipeline (drafts), shortlist, detail form, reassignment. Thin alias layer over
`app.services.bd_service`; no SQL or audit logic lives here.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.core.deps import CurrentUser, DbDep, TenantId
from app.domain.schemas.common import OkResponse
from app.domain.schemas.site import (
    ApproveShortlistRequest,
    ArchiveSiteRequest,
    AssignSubSupervisorRequest,
    CreateDraftRequest,
    ReassignSiteRequest,
    RejectSiteRequest,
    SaveDetailsRequest,
    SiteListResponse,
    SiteResponse,
    SubmitDetailsRequest,
)
from app.rbac.guards import require_role
from app.rbac.roles import Role
from app.services.audit_service import write_audit_event
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
from app.services.query_service import list_sites

router = APIRouter(prefix="/bd", tags=["BD"])


# ── Drafts ─────────────────────────────────────────────────────────────────

@router.post("/drafts", response_model=SiteResponse, status_code=status.HTTP_201_CREATED,
             summary="Create a pipeline draft")
async def create_draft(
    body: CreateDraftRequest,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.EXECUTIVE))],
    tenant_id: TenantId,
) -> SiteResponse:
    return await svc_create_draft(
        db, tenant_id=tenant_id, actor=current_user,
        name=body.name, city=body.city, visit_date=body.visit_date,
        model=body.model, spoc_name=body.spoc_name, google_pin=body.google_pin,
        expected_rent=body.expected_rent, rent_type=body.rent_type,
    )


@router.get("/drafts", response_model=SiteListResponse, summary="List pipeline drafts")
async def list_drafts(
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR, Role.SUB_SUPERVISOR))],
    tenant_id: TenantId,
) -> SiteListResponse:
    return await list_sites(db, tenant_id=tenant_id, user=current_user, status="draft_submitted")


@router.post("/drafts/{site_id}/shortlist", response_model=SiteResponse, summary="Shortlist a draft")
async def shortlist_draft(
    site_id: str,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR, Role.SUB_SUPERVISOR))],
    tenant_id: TenantId,
) -> SiteResponse:
    return await svc_shortlist_draft(db, tenant_id=tenant_id, actor=current_user, site_id=site_id)


@router.post("/drafts/{site_id}/reject", response_model=OkResponse, summary="Reject a draft")
async def reject_draft(
    site_id: str,
    body: RejectSiteRequest,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR, Role.SUB_SUPERVISOR))],
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
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR, Role.SUB_SUPERVISOR))],
    tenant_id: TenantId,
) -> OkResponse:
    return await svc_archive_site(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, note=body.note,
    )


# ── Shortlist ──────────────────────────────────────────────────────────────

@router.get("/shortlist", response_model=SiteListResponse, summary="List shortlisted sites")
async def list_shortlist(
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR, Role.SUB_SUPERVISOR))],
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
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR, Role.SUB_SUPERVISOR))],
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


@router.post("/assign-sub-supervisor", response_model=OkResponse,
             summary="Assign sub-supervisor to a city")
async def assign_sub_supervisor(
    body: AssignSubSupervisorRequest,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> OkResponse:
    from app.db import models as m
    from sqlalchemy import update
    from app.db.session import transaction

    async with transaction(db):
        await db.execute(
            update(m.User)
            .where(m.User.id == body.user_id, m.User.tenant_id == tenant_id)
            .values(role=Role.SUB_SUPERVISOR.value, assigned_city=body.city)
        )
        await write_audit_event(
            db, tenant_id=tenant_id, site_id=None,
            actor_id=current_user["sub"], actor_name=current_user["name"],
            action="assign_sub_supervisor",
            entity_id=body.user_id, entity_type="user",
            detail=f"city={body.city}",
        )
    return OkResponse(message=f"User {body.user_id} assigned as sub-supervisor for {body.city}")
