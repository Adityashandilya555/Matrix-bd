"""Pydantic schemas for the Legal Department workflow."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


# ── Step 1 · Verification Checklist ───────────────────────────────────────────

class SaveVerificationRequest(BaseModel):
    """All 7 checklist items must be answered (True = Yes, False = No)."""
    title_check: bool
    sanctioned_plan_check: bool
    oc_cc_check: bool
    commercial_uses_check: bool
    property_tax_check: bool
    electricity_check: bool
    fire_noc_verification_check: bool


# ── Step 2 · Due Diligence ────────────────────────────────────────────────────

class SaveDueDiligenceRequest(BaseModel):
    """'positive' continues the workflow; 'negative' triggers rejection + BD notification."""
    due_diligence_status: str           # 'positive' | 'negative'
    rejection_reason: Optional[str] = None   # required when status = 'negative'


# ── Step 3 · Agreement ────────────────────────────────────────────────────────

class SaveAgreementRequest(BaseModel):
    agreement_signed: bool
    agreement_registered: bool


# ── Step 4 · Licensing ────────────────────────────────────────────────────────

class SaveLicensingRequest(BaseModel):
    """Saving all 5 licensing fields auto-completes the review → LEGAL_APPROVED."""
    fssai_check: bool
    health_trade_license_check: bool
    shops_license_check: bool
    fire_noc_licensing_check: bool
    storage_license_check: bool


# ── Response models ───────────────────────────────────────────────────────────

class LegalReviewResponse(BaseModel):
    """Full state of a legal review record."""
    id: str
    site_id: str
    tenant_id: str
    reviewer_id: Optional[str] = None
    status: str

    # Step 1
    title_check: Optional[bool] = None
    sanctioned_plan_check: Optional[bool] = None
    oc_cc_check: Optional[bool] = None
    commercial_uses_check: Optional[bool] = None
    property_tax_check: Optional[bool] = None
    electricity_check: Optional[bool] = None
    fire_noc_verification_check: Optional[bool] = None

    # Step 2
    due_diligence_status: Optional[str] = None
    rejection_reason: Optional[str] = None

    # Step 3
    agreement_signed: Optional[bool] = None
    agreement_registered: Optional[bool] = None

    # Step 4
    fssai_check: Optional[bool] = None
    health_trade_license_check: Optional[bool] = None
    shops_license_check: Optional[bool] = None
    fire_noc_licensing_check: Optional[bool] = None
    storage_license_check: Optional[bool] = None

    # Timestamps
    verification_completed_at: Optional[datetime] = None
    due_diligence_completed_at: Optional[datetime] = None
    agreement_completed_at: Optional[datetime] = None
    licensing_completed_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class LegalQueueItem(BaseModel):
    """Lightweight row shown in the Legal Supervisor queue list."""
    site_id: str
    site_code: str
    site_name: str
    city: str
    legal_review_id: str
    review_status: str
    legal_review_at: Optional[datetime] = None
    submitted_by_name: Optional[str] = None


class LegalQueueResponse(BaseModel):
    items: list[LegalQueueItem]
    total: int
