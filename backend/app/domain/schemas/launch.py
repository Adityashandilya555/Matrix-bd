"""Pydantic schemas for the post-NSO Launch *validation loop*.

After NSO ``final_approved_at`` is set, the loop runs:

  NSO final approval
    → pending_admin_review     Admin reviews full details + every department
                               status; edits ONLY rent terms; leaves a comment;
                               "Send for review".
    → under_exec_review        Creating executive: read-only; Approve / Reject
                               + comment. The verdict is RECORDED and flows
                               forward (it never bounces back).
    → under_supervisor_review  Supervisor: edits rent terms; Approve / Reject
                               + comment.
    → pending_admin_final      Admin sees every rent change from draft → now and
                               both verdicts (highlighted); can make final rent
                               edits; "Confirm" ⇒ COMMIT staging into
                               site_details + sites.
    → ready_to_launch          🚀 Launch button unlocks.
    → launched

Until that final Confirm, every edit lives only on ``launch_approvals`` (the
backend staging row) and ``launch_review_events`` — the canonical
site_details / sites rent columns are untouched.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel

from app.domain.schemas.site import RentType


# ── The editable rent set ───────────────────────────────────────────────────────
# The ONLY fields any role may change inside the loop: rent terms + lock-in +
# tenure. Everything else on the record is read-only context.
RENT_EDITABLE_FIELDS: tuple[str, ...] = (
    "rent_type",
    "expected_rent",
    "fixed_rent_amt",
    "rev_share_pct",
    "escalation_pct",
    "escalation_date",
    "expected_escalation_years",
    "rent_free_days",
    "lock_in_months",
    "tenure_months",
)

# Human labels for the field-level diff timeline.
RENT_FIELD_LABELS: dict[str, str] = {
    "rent_type": "Rent type",
    "expected_rent": "Rent / MG (₹)",
    "fixed_rent_amt": "Fixed rent (₹)",
    "rev_share_pct": "Revenue share %",
    "escalation_pct": "Escalation %",
    "escalation_date": "Escalation date",
    "expected_escalation_years": "Escalation cadence (yrs)",
    "rent_free_days": "Rent-free days",
    "lock_in_months": "Lock-in (months)",
    "tenure_months": "Tenure (months)",
}


# ── Request bodies ──────────────────────────────────────────────────────────────

class LaunchRentFieldsRequest(BaseModel):
    """Partial update of the rent-only staging fields (admin / supervisor)."""
    rent_type: Optional[RentType] = None
    expected_rent: Optional[float] = None
    fixed_rent_amt: Optional[float] = None
    rev_share_pct: Optional[float] = None
    escalation_pct: Optional[float] = None
    escalation_date: Optional[date] = None
    expected_escalation_years: Optional[int] = None
    rent_free_days: Optional[int] = None
    lock_in_months: Optional[int] = None
    tenure_months: Optional[int] = None


class LaunchReviewRequest(BaseModel):
    """Executive / supervisor verdict. ``comment`` is required when rejecting."""
    verdict: str  # 'approved' | 'rejected'
    comment: Optional[str] = None


class LaunchCommentRequest(BaseModel):
    """Admin comment carried with send-for-review / final confirm."""
    comment: Optional[str] = None


# ── Read-only context blocks ────────────────────────────────────────────────────

class SiteDetailsSnapshot(BaseModel):
    """The filled "Add Details" form, read-only, for the reviewer's context."""
    name: Optional[str] = None
    city: Optional[str] = None
    model: Optional[str] = None
    google_pin: Optional[str] = None
    google_maps_url: Optional[str] = None
    visit_date: Optional[date] = None
    score: Optional[float] = None
    estimated_monthly_sales: Optional[float] = None
    nearest_starbucks: Optional[int] = None
    nearest_twc: Optional[int] = None
    carpet_area_sqft: Optional[float] = None
    cam_charges: Optional[float] = None
    capex: Optional[float] = None
    security_deposit: Optional[float] = None
    brokerage: Optional[float] = None


class DepartmentStatuses(BaseModel):
    """Status of every upstream department, so the admin can validate before launch."""
    legal_dd_status: Optional[str] = None
    agreement_status: Optional[str] = None
    licensing_status: Optional[str] = None
    design_status: Optional[str] = None
    project_status: Optional[str] = None
    finance_status: Optional[str] = None
    kyc_verified: bool = False
    ca_code: Optional[str] = None
    # NSO readiness + licenses
    nso_status: Optional[str] = None
    fssai_status: Optional[str] = None
    health_trade_status: Optional[str] = None
    shops_estab_status: Optional[str] = None
    fire_noc_status: Optional[str] = None
    storage_license_status: Optional[str] = None
    launch_date: Optional[date] = None
    nso_final_approved_at: Optional[datetime] = None


class LaunchReviewEventItem(BaseModel):
    """One entry in the recorded comment + rent-edit timeline."""
    id: str
    actor_name: Optional[str] = None
    actor_role: Optional[str] = None
    stage: str
    action: str
    comment: Optional[str] = None
    changes: Optional[list[dict[str, Any]]] = None
    created_at: Optional[datetime] = None


# ── Response bodies ──────────────────────────────────────────────────────────────

class LaunchApprovalResponse(BaseModel):
    """Full record for the detail view (admin / exec / supervisor share this)."""
    site_id: str
    site_code: Optional[str] = None
    site_name: Optional[str] = None
    city: Optional[str] = None
    tenant_id: str
    status: str

    # Editable rent staging (the working copy held in the backend)
    rent_type: Optional[str] = None
    expected_rent: Optional[float] = None
    fixed_rent_amt: Optional[float] = None
    rev_share_pct: Optional[float] = None
    escalation_pct: Optional[float] = None
    escalation_date: Optional[date] = None
    expected_escalation_years: Optional[int] = None
    rent_free_days: Optional[int] = None
    lock_in_months: Optional[int] = None
    tenure_months: Optional[int] = None
    notes: Optional[str] = None

    # Read-only context
    details: SiteDetailsSnapshot = SiteDetailsSnapshot()
    departments: DepartmentStatuses = DepartmentStatuses()
    # 'pending' until the admin opens Financial Closure, then 'open'. Lets the
    # launch drawer render the "Send for financial closure" action as already
    # sent instead of offering a re-send that the backend 409s.
    financial_closure_status: Optional[str] = None

    # Stage verdicts / comments / actors
    admin_review_comment: Optional[str] = None
    admin_sent_for_review_at: Optional[datetime] = None
    admin_sent_for_review_by_name: Optional[str] = None
    exec_verdict: Optional[str] = None
    exec_comment: Optional[str] = None
    exec_reviewed_at: Optional[datetime] = None
    exec_reviewed_by_name: Optional[str] = None
    supervisor_verdict: Optional[str] = None
    supervisor_comment: Optional[str] = None
    supervisor_reviewed_at: Optional[datetime] = None
    supervisor_reviewed_by_name: Optional[str] = None
    admin_final_comment: Optional[str] = None
    admin_confirmed_at: Optional[datetime] = None
    admin_confirmed_by_name: Optional[str] = None
    committed_at: Optional[datetime] = None
    launched_at: Optional[datetime] = None
    launched_by_name: Optional[str] = None

    # Recorded timeline (baseline → edits → verdicts → confirm → launch)
    events: list[LaunchReviewEventItem] = []

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class LaunchQueueItem(BaseModel):
    """Lightweight row shown in the launch queues."""
    site_id: str
    site_code: Optional[str] = None
    # Commercial-agreement code minted by Finance; supersedes the placeholder
    # site_code in the UI once set (the queue row prefers ca_code || site_code).
    ca_code: Optional[str] = None
    site_name: str
    city: str
    status: str
    # The site creator (executive OR supervisor — supervisors can create via
    # delegation). The first review stage is gated to this person, role-agnostic.
    submitted_by: Optional[str] = None
    created_by_name: Optional[str] = None
    exec_verdict: Optional[str] = None
    supervisor_verdict: Optional[str] = None
    updated_at: Optional[datetime] = None
    admin_sent_for_review_at: Optional[datetime] = None
    exec_reviewed_at: Optional[datetime] = None
    supervisor_reviewed_at: Optional[datetime] = None
    committed_at: Optional[datetime] = None
    launched_at: Optional[datetime] = None


class LaunchQueueResponse(BaseModel):
    items: list[LaunchQueueItem]
    total: int
