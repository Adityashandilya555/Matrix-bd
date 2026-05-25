"""Legal Department workflow router.

Endpoints:
  GET  /legal/queue                      → legal supervisor queue (LEGAL_REVIEW sites)
  GET  /legal/{site_id}                  → get full legal review for a site
  POST /legal/{site_id}/verification     → Step 1 · save verification checklist
  POST /legal/{site_id}/due-diligence    → Step 2 · positive continues; negative rejects + notifies BD
  POST /legal/{site_id}/agreement        → Step 3 · save agreement fields
  POST /legal/{site_id}/licensing        → Step 4 · save licensing → auto-approves → LEGAL_APPROVED
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.core.deps import DbDep, TenantId
from app.domain.schemas.common import OkResponse
from app.domain.schemas.legal import (
    LegalQueueResponse,
    LegalReviewResponse,
    SaveAgreementRequest,
    SaveDueDiligenceRequest,
    SaveLicensingRequest,
    SaveVerificationRequest,
)
from app.rbac.guards import require_role
from app.rbac.roles import Role
from app.services.legal_service import (
    svc_get_legal_review,
    svc_legal_queue,
    svc_save_agreement,
    svc_save_due_diligence,
    svc_save_licensing,
    svc_save_verification,
)

router = APIRouter(prefix="/legal", tags=["Legal"])

LegalUser = Annotated[dict, Depends(require_role(Role.LEGAL_SUPERVISOR))]


# ── Queue ─────────────────────────────────────────────────────────────────────

@router.get(
    "/queue",
    response_model=LegalQueueResponse,
    summary="List sites awaiting legal review",
)
async def legal_queue(
    db: DbDep,
    current_user: LegalUser,
    tenant_id: TenantId,
) -> LegalQueueResponse:
    return await svc_legal_queue(db, tenant_id=tenant_id)


@router.get(
    "/{site_id}",
    response_model=LegalReviewResponse,
    summary="Get legal review details for a site",
)
async def get_legal_review(
    site_id: str,
    db: DbDep,
    current_user: LegalUser,
    tenant_id: TenantId,
) -> LegalReviewResponse:
    return await svc_get_legal_review(db, site_id=site_id, tenant_id=tenant_id)


# ── Step 1 · Verification Checklist ──────────────────────────────────────────

@router.post(
    "/{site_id}/verification",
    response_model=LegalReviewResponse,
    summary="Step 1 · Save verification checklist",
)
async def save_verification(
    site_id: str,
    body: SaveVerificationRequest,
    db: DbDep,
    current_user: LegalUser,
    tenant_id: TenantId,
) -> LegalReviewResponse:
    return await svc_save_verification(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body,
    )


# ── Step 2 · Due Diligence ────────────────────────────────────────────────────

@router.post(
    "/{site_id}/due-diligence",
    response_model=LegalReviewResponse,
    summary="Step 2 · Submit due diligence decision (positive → continue; negative → reject)",
)
async def save_due_diligence(
    site_id: str,
    body: SaveDueDiligenceRequest,
    db: DbDep,
    current_user: LegalUser,
    tenant_id: TenantId,
) -> LegalReviewResponse:
    return await svc_save_due_diligence(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body,
    )


# ── Step 3 · Agreement ────────────────────────────────────────────────────────

@router.post(
    "/{site_id}/agreement",
    response_model=LegalReviewResponse,
    summary="Step 3 · Save agreement checklist",
)
async def save_agreement(
    site_id: str,
    body: SaveAgreementRequest,
    db: DbDep,
    current_user: LegalUser,
    tenant_id: TenantId,
) -> LegalReviewResponse:
    return await svc_save_agreement(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body,
    )


# ── Step 4 · Licensing ────────────────────────────────────────────────────────

@router.post(
    "/{site_id}/licensing",
    response_model=LegalReviewResponse,
    summary="Step 4 · Save licensing checklist → auto-approves site to LEGAL_APPROVED",
)
async def save_licensing(
    site_id: str,
    body: SaveLicensingRequest,
    db: DbDep,
    current_user: LegalUser,
    tenant_id: TenantId,
) -> LegalReviewResponse:
    return await svc_save_licensing(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body,
    )
