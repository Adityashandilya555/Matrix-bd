"""LOI (Letter of Intent) router.

`POST /loi/{id}/upload` and the alias `POST /sites/{id}/loi` both accept the
multipart form. View + timeline routes are JSON.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, UploadFile

from app.core.deps import DbDep, TenantId
from app.domain.schemas.common import OkResponse
from app.domain.schemas.loi import LOIUploadResponse, LOIViewResponse, SetLOITimelineRequest
from app.rbac.guards import require_role
from app.rbac.roles import Role
from app.services.loi_service import svc_set_loi_timeline, svc_upload_loi, svc_view_loi

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
    body = await file.read()
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
        dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR, Role.SUB_SUPERVISOR))
    ],
    tenant_id: TenantId,
) -> LOIViewResponse:
    return await svc_view_loi(db, tenant_id=tenant_id, site_id=site_id)


@router.post(
    "/{site_id}/set-timeline",
    response_model=OkResponse,
    summary="Set expected LOI timeline",
)
async def set_loi_timeline(
    site_id: str,
    body: SetLOITimelineRequest,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR, Role.SUB_SUPERVISOR))],
    tenant_id: TenantId,
) -> OkResponse:
    return await svc_set_loi_timeline(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
        expected_loi_days=body.expected_loi_days,
    )
