"""Schemas for the Financial Closure module (post-launch 'closure' budget phase).

Reuses the shared site budget (phase='closure'); each of the 11 lines carries a
per-field variation vs the approved GFC budget.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

Decision = Literal["approve", "reject"]
BudgetAction = Literal["save", "submit"]


class FCBudgetItemIn(BaseModel):
    idx: int = Field(ge=1, le=11)
    label: Optional[str] = None
    amount: Optional[float] = Field(default=None, ge=0)


class FCBudgetLineOut(BaseModel):
    idx: int
    label: Optional[str] = None
    gfc_amount: Optional[float] = None       # the approved GFC baseline
    closure_amount: Optional[float] = None   # the closure actual
    variation: Optional[float] = None        # closure - gfc


class FCQueueItem(BaseModel):
    site_id: str
    site_code: str
    site_name: str
    city: str
    closure_status: str
    financial_closure_status: str
    allocated_to_name: Optional[str] = None
    submitted_by_name: Optional[str] = None
    gfc_budget_total: Optional[float] = None
    closure_budget_total: Optional[float] = None
    variation_total: Optional[float] = None


class FCQueueResponse(BaseModel):
    items: list[FCQueueItem]
    total: int


class FCStateResponse(BaseModel):
    site_id: str
    site_code: str
    site_name: str
    city: str
    tenant_id: str
    submitted_by_name: Optional[str] = None
    is_launched: bool = False
    financial_closure_status: str
    closure_status: str
    allocated_to: Optional[str] = None
    allocated_to_name: Optional[str] = None
    gfc_budget_total: Optional[float] = None
    closure_budget_total: Optional[float] = None
    variation_total: Optional[float] = None
    # Area & covers are entered once at Project Excellence (gfc phase) and are
    # not re-edited at closure — surfaced read-only so Closure can show the
    # per-sqft / per-cover metrics without asking the user to re-enter them.
    total_indoor_area_sqft: Optional[float] = None
    total_area_sqft: Optional[float] = None
    covers: Optional[int] = None
    lines: list[FCBudgetLineOut] = Field(default_factory=list)
    supervisor_comments: Optional[str] = None
    admin_comments: Optional[str] = None
    updated_at: Optional[datetime] = None


class FCDelegationOut(BaseModel):
    id: str
    site_id: str
    module: str
    delegate_user_id: str
    delegate_email: str
    delegate_name: str
    granted_by: str
    granted_at: datetime
    notes: Optional[str] = None


class FCDelegationsResponse(BaseModel):
    items: list[FCDelegationOut]
    total: int


class AllocateFCRequest(BaseModel):
    executive_id: str
    notes: Optional[str] = None


class SaveFCBudgetRequest(BaseModel):
    # min_length=1 — same wipe guard as SavePEBudgetRequest: an empty array
    # would delete-and-reinsert all 11 closure rows as NULLs.
    items: list[FCBudgetItemIn] = Field(min_length=1)
    action: BudgetAction = "save"
    comments: Optional[str] = None


class FCReviewRequest(BaseModel):
    decision: Decision
    comments: Optional[str] = None


class FCAdminReviewRequest(FCReviewRequest):
    pass
