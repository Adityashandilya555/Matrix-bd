"""Sites router — overview list, single site, per-site tabs, action aliases.

The action routes (POST /sites, PATCH /sites/{id}/status, etc.) are thin aliases
that delegate to the underlying domain service functions. No business logic
or SQL lives in this file.
"""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status as http_status
from pydantic import BaseModel

from app.core.deps import CurrentUser, DbDep, TenantId
from app.domain.schemas.audit import AuditListResponse
from app.domain.schemas.common import OkResponse
from app.domain.schemas.loi import LOIUploadResponse
from app.domain.schemas.site import (
    ArchiveSiteRequest,
    AssignSiteRequest,
    CreateDraftRequest,
    PatchSiteDetailsRequest,
    PatchSiteStatusRequest,
    SiteListResponse,
    SiteResponse,
)
from app.domain.state_machine import SiteStatus
from app.rbac.guards import require_role
from app.rbac.roles import Role
from app.services.bd_service import (
    svc_approve_shortlist,
    svc_archive_site,
    svc_create_draft,
    svc_push_to_payments,
    svc_reassign_site,
    svc_reject_site,
    svc_revive_site,
    svc_save_details,
    svc_shortlist_draft,
    svc_submit_details,
)
from app.services.loi_service import svc_upload_loi
from app.services.query_service import get_site as svc_get_site
from app.services.query_service import list_site_activity, list_sites

router = APIRouter(prefix="/sites", tags=["Sites"])


# ── List + read ────────────────────────────────────────────────────────────

@router.get("", response_model=SiteListResponse, summary="List all sites (role + tenant scoped)")
async def list_all_sites(
    db: DbDep,
    current_user: Annotated[
        dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR))
    ],
    tenant_id: TenantId,
    status_filter: Optional[str] = Query(None, alias="status"),
    city: Optional[str] = Query(None),
) -> SiteListResponse:
    return await list_sites(
        db, tenant_id=tenant_id, user=current_user, status=status_filter, city=city,
    )


@router.get("/{site_id}", response_model=SiteResponse, summary="Get a single site (Overview tab)")
async def get_site(
    site_id: str,
    db: DbDep,
    current_user: Annotated[
        dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR))
    ],
    tenant_id: TenantId,
) -> SiteResponse:
    return await svc_get_site(db, tenant_id=tenant_id, site_id=site_id, user=current_user)


@router.get("/{site_id}/activity", response_model=AuditListResponse, summary="Site activity feed")
async def get_site_activity(
    site_id: str,
    db: DbDep,
    current_user: Annotated[
        dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR))
    ],
    tenant_id: TenantId,
) -> AuditListResponse:
    return await list_site_activity(db, tenant_id=tenant_id, site_id=site_id)


@router.get(
    "/{site_id}/documents",
    summary="Site documents list",
    description="Lists files attached to a site (LOI, photos, agreements, etc.).",
)
async def get_site_documents(
    site_id: str,
    db: DbDep,
    current_user: Annotated[
        dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR))
    ],
    tenant_id: TenantId,
) -> dict:
    from sqlalchemy import desc, select
    from app.db import models
    from app.services._common import fetch_site_or_404
    from app.services.storage_service import signed_url

    site = await fetch_site_or_404(db, site_id=site_id, tenant_id=tenant_id)
    stmt = (
        select(models.SiteFile)
        .where(models.SiteFile.site_id == site.id)
        .order_by(desc(models.SiteFile.uploaded_at))
    )
    rows = (await db.execute(stmt)).scalars().all()
    items = []
    for r in rows:
        items.append({
            "id": str(r.id),
            "file_name": r.file_name,
            "file_type": r.file_type,
            "file_size_kb": r.file_size_kb,
            "mime_type": r.mime_type,
            "uploaded_at": r.uploaded_at.isoformat(),
            "uploaded_by": str(r.uploaded_by),
            "url": await signed_url(r.storage_path),
        })
    return {"site_id": site_id, "documents": items}


# ── Action aliases ─────────────────────────────────────────────────────────

@router.post(
    "",
    response_model=SiteResponse,
    status_code=http_status.HTTP_201_CREATED,
    summary="Create a draft site (alias for POST /api/bd/drafts)",
)
async def create_site(
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


@router.patch(
    "/{site_id}/status",
    summary="Universal status-transition dispatcher (alias)",
)
async def patch_site_status(
    site_id: str,
    body: PatchSiteStatusRequest,
    db: DbDep,
    current_user: CurrentUser,
    tenant_id: TenantId,
):
    new_status = body.status
    payload = body.payload or {}

    if new_status == SiteStatus.REJECTED:
        return await svc_reject_site(
            db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
            reasons=payload.get("reasons", []), comment=payload.get("comment"),
        )
    if new_status == SiteStatus.ARCHIVED:
        return await svc_archive_site(
            db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
            note=payload.get("note"),
        )
    if new_status == SiteStatus.SHORTLISTED:
        return await svc_shortlist_draft(db, tenant_id=tenant_id, actor=current_user, site_id=site_id)
    if new_status == SiteStatus.DETAILS_SUBMITTED:
        details = payload.get("details") if isinstance(payload, dict) else None
        if details is None and isinstance(payload, dict):
            details = payload
        return await svc_submit_details(
            db, tenant_id=tenant_id, actor=current_user, site_id=site_id, details=details,
        )
    if new_status == SiteStatus.APPROVED:
        return await svc_approve_shortlist(
            db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
            expected_loi_days=int(payload.get("expectedLoiDays", 30)),
        )
    if new_status == SiteStatus.PUSHED_TO_PAYMENTS:
        # Mirror the /staging/{id}/push role-gate (Todo #7). The generic
        # status patcher is open to any authed role, but Push-to-Payments is
        # supervisor-only and we want both entry points to enforce the same
        # rule. Executives have to call the supervisor.
        if (current_user.get("role") or "").lower() != "supervisor":
            raise HTTPException(
                status_code=http_status.HTTP_403_FORBIDDEN,
                detail="Only the supervisor can push a site to Payments.",
            )
        return await svc_push_to_payments(db, tenant_id=tenant_id, actor=current_user, site_id=site_id)
    if new_status == SiteStatus.LOI_UPLOADED:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="LOI upload requires multipart — POST /api/sites/{id}/loi",
        )

    raise HTTPException(
        status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=f"No handler registered for transition to {new_status}",
    )


@router.patch(
    "/{site_id}/details",
    response_model=OkResponse,
    summary="Save partial details without transitioning",
)
async def patch_site_details(
    site_id: str,
    body: PatchSiteDetailsRequest,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.EXECUTIVE))],
    tenant_id: TenantId,
) -> OkResponse:
    return await svc_save_details(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
        details=body.details.model_dump(),
    )


@router.post("/{site_id}/archive", response_model=OkResponse, summary="Archive a site (alias)")
async def archive_site(
    site_id: str,
    body: ArchiveSiteRequest,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> OkResponse:
    return await svc_archive_site(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, note=body.note,
    )


class _ReviveSiteBody(BaseModel):
    note: Optional[str] = None


@router.post(
    "/{site_id}/revive",
    response_model=OkResponse,
    summary="Revive an archived site (supervisor only)",
)
async def revive_site(
    site_id: str,
    body: _ReviveSiteBody,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> OkResponse:
    return await svc_revive_site(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, note=body.note,
    )


class _RejectSiteBody(BaseModel):
    reasons: list[str]
    comment: Optional[str] = None


@router.post("/{site_id}/reject", response_model=OkResponse, summary="Reject a site (alias)")
async def reject_site(
    site_id: str,
    body: _RejectSiteBody,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> OkResponse:
    return await svc_reject_site(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
        reasons=body.reasons, comment=body.comment,
    )


@router.post("/{site_id}/assign", response_model=OkResponse, summary="Reassign site to exec (alias)")
async def assign_site(
    site_id: str,
    body: AssignSiteRequest,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> OkResponse:
    return await svc_reassign_site(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, new_owner_id=body.exec_id,
    )


@router.post("/{site_id}/loi", response_model=LOIUploadResponse, summary="Upload LOI (alias, multipart)")
async def upload_loi_alias(
    site_id: str,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.EXECUTIVE))],
    tenant_id: TenantId,
    file: UploadFile = File(...),
) -> LOIUploadResponse:
    body = await file.read()
    return await svc_upload_loi(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
        filename=file.filename or "loi.pdf", content_type=file.content_type, file_bytes=body,
    )
