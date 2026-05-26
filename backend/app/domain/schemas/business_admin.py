"""Pydantic schemas for the /business-admin portal."""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr


Module = Literal["bd", "legal", "payment"]


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
