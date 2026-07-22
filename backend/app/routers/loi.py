"""LOI (Letter of Intent) router.

`POST /loi/{id}/upload` and the alias `POST /sites/{id}/loi` both accept the
multipart form. View + timeline routes are JSON.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.core.deps import DbDep, TenantId
from app.core.uploads import read_upload_capped
from app.domain.schemas.common import OkResponse
from app.domain.schemas.loi import (
    LOIUploadResponse,
    LOIViewResponse,
    SendBackLOIRequest,
    SetLOITimelineRequest,
)
from app.rbac.guards import require_role
from app.rbac.roles import Role
from app.services._common import fetch_site_or_404
from app.services.loi_service import (
    svc_send_back_loi,
    svc_set_loi_timeline,
    svc_upload_loi,
    svc_view_loi,
)

router = APIRouter(prefix="/loi", tags=["LOI"])


@router.post(
    "/{site_id}/upload",
    response_model=LOIUploadResponse,
    summary="Upload signed LOI (multipart)",
)
async def upload_loi(
    site_id: str,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.EXECUTIVE))],
    tenant_id: TenantId,
    file: UploadFile = File(...),
) -> LOIUploadResponse:
    body = await read_upload_capped(file)
    return await svc_upload_loi(
        db,
        tenant_id=tenant_id, actor=current_user, site_id=site_id,
        filename=file.filename or "loi.pdf",
        content_type=file.content_type,
        file_bytes=body,
    )


@router.get(
    "/{site_id}",
    response_model=LOIViewResponse,
    summary="View LOI document (signed URL)",
)
async def view_loi(
    site_id: str,
    db: DbDep,
    current_user: Annotated[
        dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR))
    ],
    tenant_id: TenantId,
) -> LOIViewResponse:
    # Executives can only view the LOI of a site they own (submitted or assigned).
    if (current_user.get("role") or "").lower() == Role.EXECUTIVE.value:
        site = await fetch_site_or_404(db, site_id=site_id, tenant_id=tenant_id)
        uid = str(current_user["sub"])
        if str(site.submitted_by) != uid and str(site.assigned_to or "") != uid:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    return await svc_view_loi(db, tenant_id=tenant_id, site_id=site_id)


@router.post(
    "/{site_id}/send-back",
    response_model=OkResponse,
    summary="Supervisor: send an uploaded LOI back for re-upload (comments required)",
)
async def send_back_loi(
    site_id: str,
    body: SendBackLOIRequest,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> OkResponse:
    return await svc_send_back_loi(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
        comments=body.comments,
    )


@router.post(
    "/{site_id}/set-timeline",
    response_model=OkResponse,
    summary="Set expected LOI timeline",
)
async def set_loi_timeline(
    site_id: str,
    body: SetLOITimelineRequest,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> OkResponse:
    return await svc_set_loi_timeline(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
        expected_loi_days=body.expected_loi_days,
    )
