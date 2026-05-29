"""Pydantic schemas for the Legal Department workflow.

Three child tables:
  LegalDdChecklist  — due-diligence (Steps 1 + 2)
  SiteAgreement     — agreement signed/registered (Step 3)
  SiteLicensing     — licensing checklist (Step 4 / Payment module)

Checklist field values: 'pending' | 'yes' | 'no'
DD final_verdict:       'pending' | 'positive' | 'negative'
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, field_validator

ChecklistValue = Literal["pending", "yes", "no"]
ChecklistStage = Literal["draft", "pending_review", "published"]


# ── Step 1 · Save DD checklist items ─────────────────────────────────────────

class SaveVerificationRequest(BaseModel):
    """Save one or more due-diligence checklist items.

    All fields are optional so an exec can update a single item at a time.
    Fields not supplied are left unchanged. The two `other_N_label` fields
    accompany the free-form `other_N` status slots — the FE sends them
    together so the user-typed custom check name persists alongside its
    status (without this, a Save Draft round-trip wiped the label).
    """
    title_doc:       Optional[ChecklistValue] = None
    sanctioned_plan: Optional[ChecklistValue] = None
    oc_cc:           Optional[ChecklistValue] = None
    commercial_use:  Optional[ChecklistValue] = None
    property_tax:    Optional[ChecklistValue] = None
    electricity:     Optional[ChecklistValue] = None
    fire_noc:        Optional[ChecklistValue] = None
    other_1:         Optional[ChecklistValue] = None
    other_2:         Optional[ChecklistValue] = None
    # Sentinel for "clear this label": send an empty string. None means
    # "no change" (preserves the existing label across partial saves).
    other_1_label:   Optional[str] = None
    other_2_label:   Optional[str] = None


# ── Step 2 · Finalize DD verdict ─────────────────────────────────────────────

class SaveDueDiligenceRequest(BaseModel):
    """Supervisor stamps the final verdict.

    'positive' continues the workflow to Agreement.
    'negative' triggers LEGAL_REJECTED and notifies BD.
    rejection_reason is required when final_verdict == 'negative'.
    """
    final_verdict: Literal["positive", "negative"]
    rejection_reason: Optional[str] = None

    @field_validator("rejection_reason")
    @classmethod
    def reason_required_on_negative(cls, v: Optional[str], info) -> Optional[str]:
        if info.data.get("final_verdict") == "negative" and not v:
            raise ValueError("rejection_reason is required when final_verdict is 'negative'")
        return v


# ── Step 3 · Agreement ────────────────────────────────────────────────────────

class SaveAgreementRequest(BaseModel):
    """Mark agreement as signed and/or registered."""
    signed:     bool
    registered: bool
    document_url: Optional[str] = None


# ── Step 4 · Licensing ────────────────────────────────────────────────────────

class SaveLicensingRequest(BaseModel):
    """Save one or more licensing checklist items.

    When all five are 'yes', sites.licensing_status → 'complete' automatically.
    """
    fssai:          Optional[ChecklistValue] = None
    health_trade:   Optional[ChecklistValue] = None
    shops_estab_reg: Optional[ChecklistValue] = None
    fire_noc:       Optional[ChecklistValue] = None
    storage_license: Optional[ChecklistValue] = None


# ── Response models ───────────────────────────────────────────────────────────

class DdChecklistResponse(BaseModel):
    """State of the due-diligence checklist row."""
    title_doc:       str
    sanctioned_plan: str
    oc_cc:           str
    commercial_use:  str
    property_tax:    str
    electricity:     str
    fire_noc:        str
    other_1:         str
    other_2:         str
    # User-typed labels for the two free-form other slots. NULL = slot unused.
    other_1_label:   Optional[str] = None
    other_2_label:   Optional[str] = None
    final_verdict:   str
    rejection_reason: Optional[str] = None
    reviewed_by:     Optional[str] = None
    approved_by:     Optional[str] = None
    # Staging gate. Defaults to 'published' for forward-compat when the column
    # is missing (pre-migration window).
    stage:           ChecklistStage = "published"
    updated_at:      datetime


class AgreementResponse(BaseModel):
    signed:       bool
    signed_at:    Optional[datetime] = None
    registered:   bool
    registered_at: Optional[datetime] = None
    document_url: Optional[str] = None


class LicensingResponse(BaseModel):
    fssai:           str
    health_trade:    str
    shops_estab_reg: str
    fire_noc:        str
    storage_license: str
    # Staging gate. Defaults to 'published' for forward-compat when the column
    # is missing (pre-migration window).
    stage:           ChecklistStage = "published"
    updated_at:      datetime


class LegalReviewResponse(BaseModel):
    """Combined view of all three legal child tables for a site."""
    site_id:        str
    site_code:      Optional[str] = None
    site_name:      Optional[str] = None
    city:           Optional[str] = None
    submitted_by_name: Optional[str] = None
    tenant_id:      str
    site_status:    str          # current sites.status value
    legal_dd_status: Optional[str] = None    # sites mirror column
    agreement_status: Optional[str] = None  # sites mirror column
    licensing_status: Optional[str] = None  # sites mirror column (Payment)

    dd:          Optional[DdChecklistResponse] = None
    agreement:   Optional[AgreementResponse] = None
    licensing:   Optional[LicensingResponse] = None


class LegalQueueItem(BaseModel):
    """Lightweight row shown in the Legal queue list."""
    site_id:        str
    site_code:      str
    site_name:      str
    city:           str
    legal_dd_status: str          # sites.legal_dd_status mirror
    agreement_status: Optional[str] = None  # sites.agreement_status mirror
    dd_final_verdict: str         # legal_dd_checklist.final_verdict
    # Surfaces the checklist staging gate to supervisors so they can spot rows
    # an executive has submitted (stage='pending_review'). Defaults to
    # 'published' when no DD row exists yet or when the column is missing.
    dd_stage:        ChecklistStage = "published"
    legal_review_at: Optional[datetime] = None
    submitted_by_name: Optional[str] = None


class LegalQueueResponse(BaseModel):
    items: list[LegalQueueItem]
    total: int
