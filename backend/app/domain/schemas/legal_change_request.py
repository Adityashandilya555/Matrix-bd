"""Pydantic schemas for cross-module legal change requests.

Flow:
  BD opens a request against (site, target_table, field_name) asking to flip
  a 'no' value to 'yes' (or change any legal field). The legal supervisor
  approves (overwrites the underlying value immediately) or rejects.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel

TargetTable = Literal["legal_dd_checklist", "site_agreement", "site_licensing"]
ChangeRequestStatus = Literal["pending", "approved", "rejected"]


class CreateChangeRequestRequest(BaseModel):
    """BD files a request to flip one legal field on one site."""
    site_id:         str
    target_table:    TargetTable
    field_name:      str
    requested_value: str
    justification:   Optional[str] = None


class ReviewChangeRequestRequest(BaseModel):
    """Legal supervisor approves or rejects."""
    reviewer_note: Optional[str] = None


class ChangeRequestResponse(BaseModel):
    id:              str
    site_id:         str
    site_code:       str
    site_name:       str
    target_table:    str
    field_name:      str
    current_value:   str
    requested_value: str
    justification:   Optional[str] = None
    status:          str
    requested_by:    str
    requested_by_name: Optional[str] = None
    reviewed_by:     Optional[str] = None
    reviewed_by_name: Optional[str] = None
    reviewer_note:   Optional[str] = None
    created_at:      datetime
    reviewed_at:     Optional[datetime] = None


class ChangeRequestListResponse(BaseModel):
    items: list[ChangeRequestResponse]
    total: int
