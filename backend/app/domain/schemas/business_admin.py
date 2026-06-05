"""Pydantic schemas for the /business-admin portal."""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr


Module = Literal["bd", "legal", "payment", "design", "project"]


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


# ── Finance / payment admin queue ────────────────────────────────────────────

class FinanceQueueItem(BaseModel):
    site_id: str
    site_code: str
    site_name: str
    city: str
    ca_code: Optional[str] = None
    finance_amount: Optional[float] = None
    submitted_by_name: Optional[str] = None


class FinanceQueueResponse(BaseModel):
    items: list[FinanceQueueItem]
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


class OrgResponse(BaseModel):
    modules: list[OrgModuleOut]
