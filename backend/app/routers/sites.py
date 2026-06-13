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
from app.core.uploads import read_upload_capped
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
from app.domain.schemas.site_tracker import SiteTrackerResponse
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
from app.services.finance_service import (
    svc_finance_approve,
    svc_finance_reject,
    svc_finance_request_approval,
    svc_save_finance_draft,
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
    module: Optional[str] = Query(None),
) -> AuditListResponse:
    from app.services._common import assert_executive_owns_site, fetch_site_or_404

    site = await fetch_site_or_404(db, site_id=site_id, tenant_id=tenant_id)
    assert_executive_owns_site(current_user, site)
    return await list_site_activity(db, tenant_id=tenant_id, site_id=site_id, module=module)


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
    limit: int = Query(100, le=500),
) -> dict:
    from app.services.site_documents_service import get_site_documents as svc_get_docs
    return await svc_get_docs(db, site_id=site_id, tenant_id=tenant_id, current_user=current_user, limit=limit)


# ── Site Tracker (BD-safe cross-module projection) ─────────────────────────

@router.get(
    "/{site_id}/tracker",
    response_model=SiteTrackerResponse,
    summary="BD-safe site tracker projection (legal review + agreement + licensing)",
)
async def get_site_tracker(
    site_id: str,
    db: DbDep,
    current_user: Annotated[
        dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR))
    ],
    tenant_id: TenantId,
) -> SiteTrackerResponse:
    """Return the site mirror columns + DD/agreement/licensing payloads."""
    from app.services.site_tracker_service import build_tracker_response
    return await build_tracker_response(db, site_id=site_id, tenant_id=tenant_id, current_user=current_user)


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


@router.patch(
    "/{site_id}/status",
    summary="Universal status-transition dispatcher (alias)",
)
async def patch_site_status(
    site_id: str,
    body: PatchSiteStatusRequest,
    db: DbDep,
    current_user: Annotated[
        dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR))
    ],
    tenant_id: TenantId,
):
    new_status = body.status
    payload = body.payload or {}

    # #102 — mirror the dedicated /bd routes: approve/reject/shortlist/archive
    # (and the two hand-offs below) are supervisor-only. Without this, any
    # executive could drive the whole approval ladder through this dispatcher.
    _supervisor_only = {
        SiteStatus.REJECTED, SiteStatus.ARCHIVED, SiteStatus.SHORTLISTED,
        SiteStatus.APPROVED, SiteStatus.PUSHED_TO_PAYMENTS, SiteStatus.LEGAL_REVIEW,
    }
    if new_status in _supervisor_only and (current_user.get("role") or "").lower() != "supervisor":
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail=f"Only the supervisor can transition a site to {new_status.value}.",
        )

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
    if new_status == SiteStatus.LEGAL_REVIEW:
        # BD supervisor hand-off: LOI_UPLOADED → LEGAL_REVIEW. svc_push_to_payments
        # is the renamed handler that actually performs this transition + seeds
        # the legal DD checklist + notifies legal supervisors.
        if (current_user.get("role") or "").lower() != "supervisor":
            raise HTTPException(
                status_code=http_status.HTTP_403_FORBIDDEN,
                detail="Only the supervisor can send a site to Legal review.",
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


@router.post("/{site_id}/photos", summary="Upload a site photo")
async def upload_site_photo(
    site_id: str,
    db: DbDep,
    current_user: Annotated[
        dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR))
    ],
    tenant_id: TenantId,
    file: UploadFile = File(...),
) -> dict:
    """Upload a photo for a site.

    Stores the image in Supabase Storage under ``photos/{tenant}/{site}/``
    and inserts a ``site_files`` row with ``file_type='photo'``.
    Returns ``{ id, url, file_name, file_size_kb, mime_type }`` so the
    frontend can replace its local blob URL with the persisted signed URL.
    """
    from app.services.photo_service import svc_upload_photo
    body = await read_upload_capped(file)
    return await svc_upload_photo(
        db,
        tenant_id=tenant_id,
        actor=current_user,
        site_id=site_id,
        filename=file.filename or "photo.jpg",
        content_type=file.content_type,
        file_bytes=body,
    )


# ── Finance tab ───────────────────────────────────────────────────────────────

class _FinanceDraftBody(BaseModel):
    kyc_verified:   Optional[bool] = None
    ca_code:        Optional[str] = None
    finance_amount: Optional[float] = None


@router.patch(
    "/{site_id}/finance",
    summary="Save finance draft (KYC, CA code, amount)",
    description=(
        "Idempotent save — fields are only written when the finance sub-workflow is "
        "in 'pending'. Available to executives and supervisors."
    ),
)
async def save_finance_draft(
    site_id: str,
    body: _FinanceDraftBody,
    db: DbDep,
    current_user: Annotated[
        dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR))
    ],
    tenant_id: TenantId,
) -> dict:
    return await svc_save_finance_draft(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
        kyc_verified=body.kyc_verified,
        ca_code=body.ca_code,
        finance_amount=body.finance_amount,
    )


@router.post(
    "/{site_id}/finance/request-approval",
    summary="Executive requests supervisor approval for finance",
    description=(
        "Validates KYC verified + CA code set + amount entered, then transitions "
        "finance_status: pending → awaiting_supervisor and notifies supervisors."
    ),
)
async def finance_request_approval(
    site_id: str,
    db: DbDep,
    current_user: Annotated[
        dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR))
    ],
    tenant_id: TenantId,
    body: _FinanceDraftBody | None = None,
) -> dict:
    body = body or _FinanceDraftBody()
    return await svc_finance_request_approval(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
        kyc_verified=body.kyc_verified,
        ca_code=body.ca_code,
        finance_amount=body.finance_amount,
    )


@router.post(
    "/{site_id}/finance/approve",
    summary="Supervisor / admin approve finance",
    description=(
        "Role-aware approval step. Supervisor: awaiting_supervisor → awaiting_admin. "
        "Business admin: awaiting_admin → approved."
    ),
)
async def finance_approve(
    site_id: str,
    db: DbDep,
    current_user: Annotated[
        dict, Depends(require_role(Role.SUPERVISOR, Role.BUSINESS_ADMIN))
    ],
    tenant_id: TenantId,
) -> dict:
    return await svc_finance_approve(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
    )


class _FinanceRejectBody(BaseModel):
    reason: Optional[str] = None


@router.post(
    "/{site_id}/finance/reject",
    summary="Supervisor / admin reject finance — send back for correction",
    description=(
        "Resets finance_status back to 'pending' so the executive can fix "
        "KYC / CA code / amount and re-request approval."
    ),
)
async def finance_reject(
    site_id: str,
    db: DbDep,
    current_user: Annotated[
        dict, Depends(require_role(Role.SUPERVISOR, Role.BUSINESS_ADMIN))
    ],
    tenant_id: TenantId,
    body: _FinanceRejectBody | None = None,
) -> dict:
    return await svc_finance_reject(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
        reason=(body.reason if body else None),
    )


@router.post("/{site_id}/loi", response_model=LOIUploadResponse, summary="Upload LOI (alias, multipart)")
async def upload_loi_alias(
    site_id: str,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.EXECUTIVE))],
    tenant_id: TenantId,
    file: UploadFile = File(...),
) -> LOIUploadResponse:
    body = await read_upload_capped(file)
    return await svc_upload_loi(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
        filename=file.filename or "loi.pdf", content_type=file.content_type, file_bytes=body,
    )
