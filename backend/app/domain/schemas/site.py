"""Pydantic schemas for site resources."""
from __future__ import annotations
from datetime import date, datetime
from typing import Optional
from pydantic import AliasChoices, BaseModel, Field
from app.domain.state_machine import SiteStatus


# ── Request models ─────────────────────────────────────────────────────────────

class CreateDraftRequest(BaseModel):
    name: str
    city: str
    visit_date: date
    # Pipeline-stage data lifted from the shortlist form so the BE captures it upfront.
    # All optional — BE can leave them empty and fill at shortlist; values are editable later.
    # Edits to any of these post-create are diff-logged into the activity feed.
    model: Optional[str] = None
    spoc_name: Optional[str] = None
    google_pin: Optional[str] = None  # extracted "lat, lng" string
    google_maps_url: Optional[str] = None  # original Maps link the user pasted
    expected_rent: Optional[float] = None
    rent_type: Optional[str] = None  # 'fixed' | 'revshare' | 'mg_revshare'
    # Conditional, depending on rent_type. None for the rest.
    expected_escalation_pct: Optional[float] = None
    expected_escalation_years: Optional[int] = None
    expected_revshare_pct: Optional[float] = None
    score: Optional[float] = None
    est_sales: Optional[float] = None
    nearest_starbucks: Optional[float] = None
    nearest_twc: Optional[float] = None
    carpet: Optional[float] = None
    cam: Optional[float] = None
    rent: Optional[float] = None
    total_op_cost: Optional[float] = None
    revshare: Optional[float] = None
    rent_free_days: Optional[int] = None
    cadex: Optional[float] = None
    deposit: Optional[float] = None
    brokerage: Optional[float] = None
    lockin: Optional[int] = None
    tenure: Optional[int] = None


class ShortlistDraftRequest(BaseModel):
    site_id: str


class RejectSiteRequest(BaseModel):
    reasons: list[str]
    note: Optional[str] = None


class SaveDetailsRequest(BaseModel):
    """Partial 17-field form save — all fields optional so exec can save incrementally."""
    model: Optional[str] = None
    spoc_name: Optional[str] = Field(default=None, validation_alias=AliasChoices("spoc_name", "spocName"))
    google_pin: Optional[str] = Field(default=None, validation_alias=AliasChoices("google_pin", "googlePin"))
    score: Optional[float] = None
    est_sales: Optional[float] = Field(default=None, validation_alias=AliasChoices("est_sales", "estSales"))
    nearest_starbucks: Optional[float] = Field(default=None, validation_alias=AliasChoices("nearest_starbucks", "nearestStarbucks"))
    nearest_twc: Optional[float] = Field(default=None, validation_alias=AliasChoices("nearest_twc", "nearestTWC"))
    carpet: Optional[float] = None
    cam: Optional[float] = None
    rent_type: Optional[str] = Field(default=None, validation_alias=AliasChoices("rent_type", "rentType"))
    rent: Optional[float] = None
    escalation: Optional[float] = None
    revshare: Optional[float] = None
    rent_free_days: Optional[int] = Field(default=None, validation_alias=AliasChoices("rent_free_days", "rentFreeDays"))
    cadex: Optional[float] = None
    deposit: Optional[float] = None
    brokerage: Optional[float] = None
    lockin: Optional[int] = None
    tenure: Optional[int] = None
    total_op_cost: Optional[float] = Field(default=None, validation_alias=AliasChoices("total_op_cost", "totalOpCost"))


class SubmitDetailsRequest(SaveDetailsRequest):
    """Submit for review — same fields but all required fields must be present."""
    pass


class ApproveShortlistRequest(BaseModel):
    expected_loi_days: int


class ReassignSiteRequest(BaseModel):
    new_owner_id: str


class ArchiveSiteRequest(BaseModel):
    note: str | None = None


class PatchSiteStatusRequest(BaseModel):
    status: SiteStatus
    payload: dict | None = None


class PatchSiteDetailsRequest(BaseModel):
    details: SaveDetailsRequest


class AssignSiteRequest(BaseModel):
    exec_id: str


# ── Response models ─────────────────────────────────────────────────────────────

class SiteResponse(BaseModel):
    id: str
    code: str
    name: str
    city: str
    tenant_id: str
    status: SiteStatus
    created_by: str
    submitted_by: Optional[str] = None
    assigned_to: Optional[str] = None
    assigned_to_name: Optional[str] = None
    supervisor_id: Optional[str] = None
    visit_date: Optional[date] = None
    days: Optional[int] = None
    stage: Optional[str] = None
    details_completion: Optional[str] = None
    # Pipeline-stage fields (also editable at shortlist; diff-logged on change)
    model: Optional[str] = None
    spoc_name: Optional[str] = None
    google_pin: Optional[str] = None
    google_maps_url: Optional[str] = None
    expected_rent: Optional[float] = None
    rent_type: Optional[str] = None
    expected_escalation_pct: Optional[float] = None
    expected_escalation_years: Optional[int] = None
    expected_revshare_pct: Optional[float] = None
    # Persisted 17-field details from the shortlist form. These power the
    # read-only site drawer and must never be synthesized by the frontend.
    score: Optional[float] = None
    est_sales: Optional[float] = None
    nearest_starbucks: Optional[float] = None
    nearest_twc: Optional[float] = None
    carpet: Optional[float] = None
    cam: Optional[float] = None
    rent: Optional[float] = None
    total_op_cost: Optional[float] = None
    escalation: Optional[float] = None
    rent_free_days: Optional[int] = None
    cadex: Optional[float] = None
    deposit: Optional[float] = None
    brokerage: Optional[float] = None
    lockin: Optional[int] = None
    tenure: Optional[int] = None
    details_saved_at: Optional[datetime] = None
    legal_dd_status: Optional[str] = None
    agreement_status: Optional[str] = None
    licensing_status: Optional[str] = None
    design_status: Optional[str] = None


class SiteListResponse(BaseModel):
    items: list[SiteResponse]
    total: int
