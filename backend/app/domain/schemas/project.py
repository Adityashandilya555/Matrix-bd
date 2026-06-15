"""Schemas for the Project Execution module.

Budget tracking (11 items) has moved to the Project Excellence module (202606134).
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


Decision = Literal["approve", "reject"]
MilestoneField = Literal[
    "initialization_date",
    "expected_completion_date",
    "inspection_date",
    "final_completion_date",
]


class ProjectBudgetLine(BaseModel):
    """A read-only line from the approved post-GFC budget (Project Excellence)."""
    idx: int
    label: Optional[str] = None
    amount: Optional[float] = None


class ProjectQueueItem(BaseModel):
    site_id: str
    site_code: str
    site_name: str
    city: str
    design_status: str
    project_status: str
    current_stage: str
    # Drives the Pipeline vs Sites split: a site moves to the "Sites" tab once
    # the executive has uploaded the quality-audit doc (status leaves 'pending').
    quality_audit_status: str = "pending"
    inspection_date: Optional[date] = None
    # Completion timestamp (set when the PE supervisor marks the quality audit
    # Completed). Surfaced in the PE Quality-Audit tab and the NSO Handover tab.
    project_completed_at: Optional[datetime] = None
    allocated_to_name: Optional[str] = None
    submitted_by_name: Optional[str] = None


class ProjectQueueResponse(BaseModel):
    items: list[ProjectQueueItem]
    total: int


class ProjectStateResponse(BaseModel):
    site_id: str
    site_code: str
    site_name: str
    city: str
    tenant_id: str
    submitted_by_name: Optional[str] = None
    site_status: str
    design_status: str
    project_status: str
    current_stage: str
    allocated_to: Optional[str] = None
    allocated_to_name: Optional[str] = None
    initialization_date: Optional[date] = None
    initialization_status: str
    initialization_comments: Optional[str] = None
    expected_completion_date: Optional[date] = None
    expected_completion_status: str
    expected_completion_comments: Optional[str] = None
    mid_project_visit_date: Optional[date] = None
    inspection_date: Optional[date] = None
    quality_audit_status: str
    quality_audit_comments: Optional[str] = None
    # Quality audit two-tier sign-off (calendar date, no document upload):
    # executive submits inspection_date → supervisor approves → business_admin confirms.
    quality_audit_supervisor_approved_at: Optional[datetime] = None
    quality_audit_admin_confirmed_at: Optional[datetime] = None
    quality_audit_admin_notes: Optional[str] = None
    final_completion_date: Optional[date] = None
    project_completed_at: Optional[datetime] = None
    nso_status: str = "pending"
    pushed_to_nso_at: Optional[datetime] = None
    # Read-only post-GFC budget (owned by Project Excellence / site_budgets).
    budget_status: str = "draft"
    budget_total: Optional[float] = None
    budget_items: list["ProjectBudgetLine"] = Field(default_factory=list)
    # Area & covers live on the GFC SiteBudget too; surfaced read-only so the
    # Project module can show them and the per-sqft / per-cover metrics.
    total_indoor_area_sqft: Optional[float] = None
    total_area_sqft: Optional[float] = None
    covers: Optional[int] = None
    updated_at: datetime


class ProjectDelegationOut(BaseModel):
    id: str
    site_id: str
    module: str
    delegate_user_id: str
    delegate_email: str
    delegate_name: str
    granted_by: str
    granted_at: datetime
    notes: Optional[str] = None


class ProjectDelegationsResponse(BaseModel):
    items: list[ProjectDelegationOut]
    total: int


class AllocateProjectRequest(BaseModel):
    executive_id: str
    notes: Optional[str] = None


class ReviewRequest(BaseModel):
    decision: Decision
    comments: Optional[str] = None


class AdminConfirmQualityAuditRequest(ReviewRequest):
    # business_admin's quality-audit confirmation (with optional notes).
    admin_notes: Optional[str] = None


class MilestoneRequest(BaseModel):
    value: date


class InitializationRespondRequest(BaseModel):
    # Executive's response to the admin-proposed initialization date.
    decision: Decision
    comments: Optional[str] = None


class InitializationProposeRequest(BaseModel):
    # Supervisor proposes the initialization date from inside the Project module
    # when the admin handover never seeded one (status still 'pending'). Recovery
    # path so the initialization exchange can always start.
    value: date


class InitializationFinalizeRequest(BaseModel):
    # Supervisor's final initialization date after the executive rejected.
    value: date


class MidVisitRequest(BaseModel):
    # Supervisor's mid-project visit date.
    value: date


class ProjectHistoryItem(BaseModel):
    """Read-only history row for every site that entered Project."""
    site_id: str
    site_code: str
    site_name: str
    city: str
    submitted_by_name: Optional[str] = None
    design_status: str
    project_status: str = "pending"
    current_stage: str = "execution"
    project_completed_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ProjectHistoryResponse(BaseModel):
    items: list[ProjectHistoryItem]
    total: int
