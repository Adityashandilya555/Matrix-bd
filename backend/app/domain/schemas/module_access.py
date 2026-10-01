"""Pydantic schemas for supervisor cross-module workspace access.

A grant lets a supervisor of one module act as a supervisor of another. It is a
simulation, never a membership — see
database/migrations/20260930_supervisor_module_access_grants.sql.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel

# Reused rather than re-spelled, so a retired or added module cannot disagree
# between this surface and the rest of the API.
from app.domain.schemas.business_admin import Module


class ModuleAccessStateOut(BaseModel):
    """One row of the supervisor's own "Module access" page.

    `state` is what the row's control renders from:
      home    — the module this supervisor actually belongs to; no action
      granted — an approved grant; "Enter workspace"
      pending — requested, awaiting a business admin
      none    — requestable. `last_decision` says whether a previous attempt was
                turned down or withdrawn, so the page can say so without a
                second call.
    """
    module: Module
    state: Literal["home", "granted", "pending", "none"]
    last_decision: Optional[Literal["rejected", "revoked"]] = None
    requested_at: Optional[datetime] = None
    decided_at: Optional[datetime] = None


class ModuleAccessRequestIn(BaseModel):
    module: Module


class ModuleAccessRequestOut(BaseModel):
    """A pending request, as the business admin sees it."""
    id: str
    supervisor_id: str
    supervisor_email: str
    supervisor_name: str
    # The module the requester actually supervises, so the admin can read the
    # request as "Legal's supervisor wants BD" rather than just a name.
    home_module: Optional[Module] = None
    module: Module
    created_at: datetime


class ModuleAccessGrantOut(BaseModel):
    """A live grant, as the business admin sees it."""
    id: str
    supervisor_id: str
    supervisor_email: str
    supervisor_name: str
    module: Module
    decided_at: Optional[datetime] = None
    # Executives in the granted module who report to this supervisor. Revoking
    # does not remove them, so the admin needs to see the consequence first.
    recruited_count: int = 0
