"""Pydantic schemas for the post-NSO Launch Approval workflow.

After NSO final_approved_at is set, the approval chain runs:

  NSO Final Approval
    → Admin reviews + edits commercial fields → admin_approve
    → BD confirms                             → bd_confirm
    → Supervisor approves                     → supervisor_approve
    → Super Admin approves                    → super_admin_approve
    → Admin launches                          → launch
    → site.is_launched = True (cross-module highlight)
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel


# ── Request bodies ─────────────────────────────────────────────────────────────

class LaunchFieldsRequest(BaseModel):
    """Admin saves (or updates) the editable commercial snapshot."""
    rent_type: Optional[str] = None
    fixed_rent_amt: Optional[float] = None
    expected_rent: Optional[float] = None
    rev_share_pct: Optional[float] = None
    escalation_pct: Optional[float] = None
    escalation_date: Optional[date] = None
    expected_escalation_years: Optional[int] = None
    cam_charges: Optional[float] = None
    security_deposit: Optional[float] = None
    brokerage: Optional[float] = None
    lock_in_months: Optional[int] = None
    tenure_months: Optional[int] = None
    rent_free_days: Optional[int] = None
    carpet_area_sqft: Optional[float] = None
    estimated_monthly_sales: Optional[float] = None
    capex: Optional[float] = None
    score: Optional[float] = None
    notes: Optional[str] = None


# ── Response bodies ────────────────────────────────────────────────────────────

class LaunchApprovalResponse(BaseModel):
    """Full approval record returned to the frontend for the detail view."""
    site_id: str
    site_code: Optional[str] = None
    site_name: Optional[str] = None
    city: Optional[str] = None
    tenant_id: str
    status: str

    # Commercial snapshot
    rent_type: Optional[str] = None
    fixed_rent_amt: Optional[float] = None
    expected_rent: Optional[float] = None
    rev_share_pct: Optional[float] = None
    escalation_pct: Optional[float] = None
    escalation_date: Optional[date] = None
    expected_escalation_years: Optional[int] = None
    cam_charges: Optional[float] = None
    security_deposit: Optional[float] = None
    brokerage: Optional[float] = None
    lock_in_months: Optional[int] = None
    tenure_months: Optional[int] = None
    rent_free_days: Optional[int] = None
    carpet_area_sqft: Optional[float] = None
    estimated_monthly_sales: Optional[float] = None
    capex: Optional[float] = None
    score: Optional[float] = None
    notes: Optional[str] = None

    # Approval chain
    admin_approved_at: Optional[datetime] = None
    admin_approved_by_name: Optional[str] = None
    bd_confirmed_at: Optional[datetime] = None
    bd_confirmed_by_name: Optional[str] = None
    supervisor_approved_at: Optional[datetime] = None
    supervisor_approved_by_name: Optional[str] = None
    super_admin_approved_at: Optional[datetime] = None
    super_admin_approved_by_name: Optional[str] = None
    launched_at: Optional[datetime] = None
    launched_by_name: Optional[str] = None

    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class LaunchQueueItem(BaseModel):
    """Lightweight row shown in the admin launch approval queue."""
    site_id: str
    site_code: Optional[str] = None
    site_name: str
    city: str
    status: str
    updated_at: Optional[datetime] = None
    admin_approved_at: Optional[datetime] = None
    bd_confirmed_at: Optional[datetime] = None
    supervisor_approved_at: Optional[datetime] = None
    super_admin_approved_at: Optional[datetime] = None
    launched_at: Optional[datetime] = None


class LaunchQueueResponse(BaseModel):
    items: list[LaunchQueueItem]
    total: int
