"""Pydantic schemas for the /business-admin portal."""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr


Module = Literal["bd", "legal", "design", "project", "nso", "project_excellence"]  # 'payment' retired (202606132); 'project_excellence' added (202606134)


class ModuleCodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    module: Module
    code: str
    created_at: datetime
    rotated_at: Optional[datetime] = None


class DeptCodeRotateOut(BaseModel):
    module: Module
    code: str


class PendingSupervisorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: EmailStr
    module: Module
    created_at: datetime


class ApproveSupervisorIn(BaseModel):
    module: Module


class FinanceApprovalOut(BaseModel):
    site_id: str
    site_code: str
    site_name: str
    city: str
    site_status: str
    submitted_by_name: Optional[str] = None
    ca_code: Optional[str] = None
    finance_amount: Optional[float] = None
    kyc_verified: bool = False
    finance_status: str
    # Upstream legal/agreement/licensing state, so the admin's finance sign-off
    # shows the real legal status instead of a default "pending".
    legal_dd_status: Optional[str] = None
    agreement_status: Optional[str] = None
    licensing_status: Optional[str] = None
    updated_at: datetime


class AdminSiteOut(BaseModel):
    site_id: str
    site_code: str
    site_name: str
    city: str
    site_status: str
    submitted_by_name: Optional[str] = None
    assigned_to_name: Optional[str] = None
    supervisor_name: Optional[str] = None
    legal_dd_status: Optional[str] = None
    agreement_status: Optional[str] = None
    licensing_status: Optional[str] = None
    finance_status: str = "pending"
    design_status: Optional[str] = None
    project_status: Optional[str] = None
    project_current_stage: Optional[str] = None
    project_budget_status: Optional[str] = None
    project_completed_at: Optional[datetime] = None
    nso_status: Optional[str] = None
    nso_current_stage: Optional[str] = None
    launch_status: Optional[str] = None
    financial_closure_status: Optional[str] = None
    is_launched: bool = False
    launched_at: Optional[datetime] = None
    ca_code: Optional[str] = None
    finance_amount: Optional[float] = None
    kyc_verified: bool = False
    created_at: datetime
    updated_at: datetime
    draft_submitted_at: Optional[datetime] = None
    shortlisted_at: Optional[datetime] = None
    details_submitted_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    loi_uploaded_at: Optional[datetime] = None
    legal_review_at: Optional[datetime] = None
    legal_approved_at: Optional[datetime] = None
    legal_rejected_at: Optional[datetime] = None
    pushed_to_payments_at: Optional[datetime] = None
    design_approved_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None


class AdminSitesResponse(BaseModel):
    items: list[AdminSiteOut]
    total: int


# ── Department org tree (supervisors + the executives under them) ─────────────

class OrgExecutiveOut(BaseModel):
    id: str
    email: EmailStr
    name: str
    joined_at: Optional[datetime] = None


class OrgSupervisorOut(BaseModel):
    id: str
    email: EmailStr
    name: str
    joined_at: Optional[datetime] = None
    executives: list[OrgExecutiveOut] = []


class OrgModuleOut(BaseModel):
    module: Module
    code: Optional[str] = None
    supervisors: list[OrgSupervisorOut] = []
    unassigned_executives: list[OrgExecutiveOut] = []
    # False for supervisor-only modules (NSO) — the UI hides executive slots/codes.
    executives_enabled: bool = True


class OrgResponse(BaseModel):
    modules: list[OrgModuleOut]
