"""Pydantic schemas for per-supervisor invite codes + pending-executive approvals."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr

Module = Literal["bd", "legal", "payment", "design", "recce", "project"]


class InviteCodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    module: Module
    code: str
    created_at: datetime
    rotated_at: datetime | None = None


class PendingExecOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: EmailStr
    module: Module
    created_at: datetime


class TeamMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: EmailStr
    name: str | None = None
    module: Module
    joined_at: datetime
