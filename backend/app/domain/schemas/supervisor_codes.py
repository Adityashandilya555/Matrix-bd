"""Pydantic schemas for per-supervisor invite codes + pending-executive approvals."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

Module = Literal["bd", "legal", "design", "project", "nso", "project_excellence"]  # 'payment' retired (202606132); 'project_excellence' added (202606134)


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


class AvailableExecutiveOut(BaseModel):
    """An executive in this module who is NOT yet on the caller's team.

    Deliberately not TeamMemberOut: that carries `joined_at`, which is the date
    they joined MY team — and the whole point of this list is that they have not.
    Reusing it made the endpoint 500 on any non-empty result while validating
    fine when empty, so it looked healthy right up until it had something to say.
    """
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: str
    name: str | None = None
    module: Module


class TeamMemberOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: str
    name: str | None = None
    module: Module
    joined_at: datetime
