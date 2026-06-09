"""Schemas for the Project Execution module."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


Decision = Literal["approve", "reject"]
BudgetAction = Literal["save", "submit"]
MilestoneField = Literal[
    "initialization_date",
    "expected_completion_date",
    "inspection_date",
    "final_completion_date",
]


class ProjectBudgetItemIn(BaseModel):
    idx: int = Field(ge=1, le=11)
    label: Optional[str] = None
    amount: Optional[float] = Field(default=None, ge=0)


class ProjectBudgetItemOut(ProjectBudgetItemIn):
    id: Optional[str] = None


class ProjectQueueItem(BaseModel):
    site_id: str
    site_code: str
    site_name: str
    city: str
    design_status: str
    project_status: str
    current_stage: str
    budget_status: str
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
    budget_status: str
    budget_total: Optional[float] = None
    total_indoor_area_sqft: Optional[float] = None
    total_area_sqft: Optional[float] = None
    covers: Optional[int] = None
    budget_items: list[ProjectBudgetItemOut] = Field(default_factory=list)
    budget_supervisor_comments: Optional[str] = None
    budget_admin_comments: Optional[str] = None
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
    quality_audit_download_url: Optional[str] = None
    final_completion_date: Optional[date] = None
    project_completed_at: Optional[datetime] = None
    nso_status: str = "pending"
    pushed_to_nso_at: Optional[datetime] = None
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


class SaveBudgetRequest(BaseModel):
    items: list[ProjectBudgetItemIn] = Field(default_factory=list)
    action: BudgetAction = "save"
    # Area / cover inputs travel with the budget so they are captured at the
    # same save/submit step and carried into the approval flow.
    total_indoor_area_sqft: Optional[float] = Field(default=None, ge=0)
    total_area_sqft: Optional[float] = Field(default=None, ge=0)
    covers: Optional[int] = Field(default=None, ge=0)


class ReviewRequest(BaseModel):
    decision: Decision
    comments: Optional[str] = None


class AdminBudgetReviewRequest(ReviewRequest):
    # On approve, the business-admin also sets the project initialization date
    # (the UI defaults this to approval date + 2 days). Optional so a reject
    # need not carry one; the service defaults it when omitted on approve.
    initialization_date: Optional[date] = None


class MilestoneRequest(BaseModel):
    value: date


class InitializationRespondRequest(BaseModel):
    # Executive's response to the admin-proposed initialization date.
    decision: Decision
    comments: Optional[str] = None


class InitializationFinalizeRequest(BaseModel):
    # Supervisor's final initialization date after the executive rejected.
    value: date


class MidVisitRequest(BaseModel):
    # Supervisor's mid-project visit date.
    value: date


class ProjectBudgetAdminQueueResponse(BaseModel):
    items: list[ProjectQueueItem]
    total: int


class ProjectHistoryItem(BaseModel):
    """Read-only history row for every site that entered Project."""
    site_id: str
    site_code: str
    site_name: str
    city: str
    submitted_by_name: Optional[str] = None
    design_status: str
    project_status: str = "pending"
    current_stage: str = "budget"
    budget_status: str = "draft"
    project_completed_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ProjectHistoryResponse(BaseModel):
    items: list[ProjectHistoryItem]
    total: int
