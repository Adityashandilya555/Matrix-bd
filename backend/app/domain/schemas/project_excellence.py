"""Schemas for the Project Excellence module (budget tracking after project completion)."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


Decision = Literal["approve", "reject"]
BudgetAction = Literal["save", "submit"]


class PEBudgetItemIn(BaseModel):
    idx: int = Field(ge=1, le=11)
    label: Optional[str] = None
    amount: Optional[float] = Field(default=None, ge=0)


class PEBudgetItemOut(PEBudgetItemIn):
    id: Optional[str] = None


class PEQueueItem(BaseModel):
    site_id: str
    site_code: str
    site_name: str
    city: str
    project_status: str
    excellence_status: str
    budget_status: str
    allocated_to_name: Optional[str] = None
    submitted_by_name: Optional[str] = None
    budget_total: Optional[float] = None


class PEQueueResponse(BaseModel):
    items: list[PEQueueItem]
    total: int


class PEStateResponse(BaseModel):
    site_id: str
    site_code: str
    site_name: str
    city: str
    tenant_id: str
    submitted_by_name: Optional[str] = None
    site_status: str
    project_status: str
    excellence_status: str
    current_stage: str
    allocated_to: Optional[str] = None
    allocated_to_name: Optional[str] = None
    budget_status: str
    budget_total: Optional[float] = None
    total_indoor_area_sqft: Optional[float] = None
    total_area_sqft: Optional[float] = None
    covers: Optional[int] = None
    budget_items: list[PEBudgetItemOut] = Field(default_factory=list)
    budget_supervisor_comments: Optional[str] = None
    budget_admin_comments: Optional[str] = None
    updated_at: datetime


class PEDelegationOut(BaseModel):
    id: str
    site_id: str
    module: str
    delegate_user_id: str
    delegate_email: str
    delegate_name: str
    granted_by: str
    granted_at: datetime
    notes: Optional[str] = None


class PEDelegationsResponse(BaseModel):
    items: list[PEDelegationOut]
    total: int


class AllocatePERequest(BaseModel):
    executive_id: str
    notes: Optional[str] = None


class SavePEBudgetRequest(BaseModel):
    items: list[PEBudgetItemIn] = Field(default_factory=list)
    action: BudgetAction = "save"
    total_indoor_area_sqft: Optional[float] = Field(default=None, ge=0)
    total_area_sqft: Optional[float] = Field(default=None, ge=0)
    covers: Optional[int] = Field(default=None, ge=0)


class ReviewRequest(BaseModel):
    decision: Decision
    comments: Optional[str] = None


class AdminBudgetReviewRequest(ReviewRequest):
    # On approval the admin sets the project initialization date; it seeds the
    # Project module's initialization (status → 'proposed') so the executive can
    # accept/reject it. Required when approving (enforced in the service).
    initialization_date: Optional[date] = None


class PEBudgetAdminQueueResponse(BaseModel):
    items: list[PEQueueItem]
    total: int
