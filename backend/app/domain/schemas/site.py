"""Pydantic schemas for site resources."""
from __future__ import annotations
from datetime import date, datetime
from typing import List, Literal, Optional
from pydantic import AliasChoices, BaseModel, Field, field_validator, model_validator
from app.domain.state_machine import SiteStatus

# Closed vocabulary mirroring the live DB CHECK constraint on sites.rent_type.
# Using a Literal here converts a latent IntegrityError 500 into a clean 422
# before any SQL is issued (issue #166).
RentType = Literal["fixed", "revshare", "mg_revshare", "staggered"]


# Schemes that execute or embed code when rendered as an <a href>. Blocking
# THESE — not "anything that isn't http(s)" — is the real stored-XSS guard from
# #87 (the value is shown as a link to other users in SiteDrawer / NsoReviewPage).
_DANGEROUS_URL_SCHEMES = (
    "javascript:", "data:", "vbscript:", "file:", "blob:", "about:", "mailto:",
)


def _validate_http_url(v: Optional[str]) -> Optional[str]:
    """Normalise + scheme-guard a user-pasted Google Maps URL.

    The original #87 guard rejected anything not starting with http(s):// — but
    users routinely paste a *bare* link (``google.com/maps/…``,
    ``maps.app.goo.gl/…``) with no scheme, which made every such create fail
    with a 422. We instead:

      * reject the dangerous schemes that are the actual XSS vector,
      * pass through real http(s) URLs unchanged,
      * reject any *other* explicit scheme (ftp:, custom:, …), and
      * coerce a scheme-less link to https:// so the stored value is always a
        safe http(s) href — restoring the pre-#87 paste-and-go behaviour.
    """
    if v is None:
        return v
    v = v.strip()
    if not v:
        return None
    low = v.lower()
    if low.startswith(_DANGEROUS_URL_SCHEMES):
        raise ValueError("google_maps_url must be an http(s) URL")
    if low.startswith(("http://", "https://")):
        return v
    if "://" in v:  # some other explicit scheme we don't trust to render
        raise ValueError("google_maps_url must be an http(s) URL")
    return "https://" + v


# ── Request models ─────────────────────────────────────────────────────────────

class StaggeredEscalationItem(BaseModel):
    """One year's escalation entry for staggered rent."""
    year: int = Field(..., gt=0, description="Escalation year (1-based, relative to lease start)")
    percent: float = Field(..., gt=0, le=100, description="Percentage increase for that year")


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

    @field_validator("google_maps_url")
    @classmethod
    def _maps_url_scheme(cls, v: Optional[str]) -> Optional[str]:
        return _validate_http_url(v)
    expected_rent: Optional[float] = None
    rent_type: Optional[RentType] = None
    # Conditional, depending on rent_type. None for the rest.
    expected_escalation_pct: Optional[float] = Field(default=None, ge=0, le=100)
    # Cadence in YEARS (1 = yearly, 3 = every 3 yrs). Bounded to a sane lease horizon
    # so out-of-range input returns a clean 422 instead of a database error.
    expected_escalation_years: Optional[int] = Field(default=None, ge=0, le=99)
    expected_revshare_pct: Optional[float] = Field(default=None, ge=0, le=100)
    # Pipeline-stage area in sqft. Defaults to 0; editable later in Add Details.
    area_sqft: Optional[float] = Field(default=None, ge=0, description="Site area in square feet")
    # Staggered rent escalation schedule: required when rent_type == 'staggered'.
    staggered_escalation: Optional[List[StaggeredEscalationItem]] = Field(
        default=None,
        description="Up to 5 escalation entries; required when rent_type='staggered'",
    )
    # Site score is a decimal 1-5 rating. Bounded on input; output remains unconstrained
    # so legacy rows (e.g. 0-100) do not cause validation errors.
    score: Optional[float] = Field(default=None, ge=1, le=5)
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

    @model_validator(mode="after")
    def _staggered_requirements(self) -> "CreateDraftRequest":
        """When rent_type is 'staggered', enforce required fields."""
        if self.rent_type == "staggered":
            if self.expected_rent is None:
                raise ValueError("expected_rent is required for staggered rent")
            esc = self.staggered_escalation
            if not esc or len(esc) == 0:
                raise ValueError("staggered_escalation schedule is required for staggered rent")
            if len(esc) > 5:
                raise ValueError("Maximum of 5 escalation entries allowed")
            years = {e.year for e in esc}
            if len(years) != len(esc):
                raise ValueError("Escalation years must be unique")
        return self


class ShortlistDraftRequest(BaseModel):
    site_id: str


class RejectSiteRequest(BaseModel):
    reasons: list[str]
    note: Optional[str] = None


class SaveDetailsRequest(BaseModel):
    """Partial 17-field form save — all fields optional so exec can save incrementally."""
    name: Optional[str] = None
    city: Optional[str] = None
    model: Optional[str] = None
    spoc_name: Optional[str] = Field(default=None, validation_alias=AliasChoices("spoc_name", "spocName"))
    google_pin: Optional[str] = Field(default=None, validation_alias=AliasChoices("google_pin", "googlePin"))
    # Decimal 1-5 rating (see CreateDraftRequest.score). Bounded on input only.
    score: Optional[float] = Field(default=None, ge=1, le=5)
    est_sales: Optional[float] = Field(default=None, validation_alias=AliasChoices("est_sales", "estSales"))
    nearest_starbucks: Optional[float] = Field(default=None, validation_alias=AliasChoices("nearest_starbucks", "nearestStarbucks"))
    nearest_twc: Optional[float] = Field(default=None, validation_alias=AliasChoices("nearest_twc", "nearestTWC"))
    carpet: Optional[float] = None
    cam: Optional[float] = None
    rent_type: Optional[RentType] = Field(default=None, validation_alias=AliasChoices("rent_type", "rentType"))
    rent: Optional[float] = None
    escalation: Optional[float] = Field(default=None, ge=0, le=100)
    revshare: Optional[float] = Field(default=None, ge=0, le=100)
    rent_free_days: Optional[int] = Field(default=None, validation_alias=AliasChoices("rent_free_days", "rentFreeDays"))
    cadex: Optional[float] = None
    deposit: Optional[float] = None
    brokerage: Optional[float] = None
    lockin: Optional[int] = None
    tenure: Optional[int] = None
    total_op_cost: Optional[float] = Field(default=None, validation_alias=AliasChoices("total_op_cost", "totalOpCost"))
    # Pipeline-stage area (sqft) — editable via Add Details
    area_sqft: Optional[float] = Field(default=None, ge=0, validation_alias=AliasChoices("area_sqft", "areaSqft"))
    # Staggered escalation schedule — passed through to sites row
    staggered_escalation: Optional[List[StaggeredEscalationItem]] = Field(
        default=None,
        validation_alias=AliasChoices("staggered_escalation", "staggeredEscalation"),
    )


class SubmitDetailsRequest(SaveDetailsRequest):
    """Submit for review — same fields but all required fields must be present."""


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
    area_sqft: float = 0
    staggered_escalation: Optional[list] = None

    @field_validator("staggered_escalation", mode="before")
    @classmethod
    def _parse_staggered_escalation(cls, v: Optional[list | str]) -> Optional[list]:
        """Safely parse legacy stringified JSON in the staggered_escalation column."""
        if isinstance(v, str):
            import json
            try:
                parsed = json.loads(v)
                return parsed if isinstance(parsed, list) else None
            except Exception:
                return None
        return v

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
    project_status: Optional[str] = None
    project_current_stage: Optional[str] = None
    project_budget_status: Optional[str] = None
    nso_status: Optional[str] = None
    nso_current_stage: Optional[str] = None
    launch_status: Optional[str] = None
    is_launched: bool = False
    launched_at: Optional[datetime] = None
    # Finance / CA mirror columns for Payments and Launch views.
    finance_status: Optional[str] = None
    kyc_verified: bool = False
    # Output schema lacks constraints to avoid validation errors on legacy rows.
    ca_code: Optional[str] = None
    finance_amount: Optional[float] = None
    # LOI SLA tracking: expected_loi_days, approved_at, loi_uploaded_at, approved_by
    # drive the supervisor's on-time vs overdue counters.
    expected_loi_days: Optional[int] = None
    approved_at: Optional[datetime] = None
    approved_by: Optional[str] = None
    loi_uploaded_at: Optional[datetime] = None
    # Reject / archive justification shown on the Archive page's Reason column.
    rejection_reason: Optional[str] = None
    archive_note: Optional[str] = None
    archived_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    # Pipeline fields a supervisor amended that the site's executive hasn't
    # re-viewed yet. Drives the yellow site flag + per-field eye highlight;
    # audit-derived, cleared once the exec re-opens the site. Empty by default.
    supervisor_edited_fields: List[str] = Field(default_factory=list)


class SiteListResponse(BaseModel):
    items: list[SiteResponse]
    total: int
