"""Pydantic schemas for per-supervisor invite codes + pending-executive approvals."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

Module = Literal["bd", "legal", "payment", "design", "project", "nso"]


class InviteCodeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    module: Module
    code: str
    created_at: datetime
    rotated_at: datetime | None = None


class PendingExecOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: str
    module: Module
    created_at: datetime


class TeamMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: str
    name: str | None = None
    module: Module
    joined_at: datetime
