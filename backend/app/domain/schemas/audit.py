"""Pydantic schemas for audit events."""
from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class AuditEvent(BaseModel):
    id: str
    site_id: Optional[str] = None  # nullable for non-site events (e.g. assign_sub_supervisor)
    actor: str  # denormalised actor name (audit_logs.actor_name)
    action: str
    from_status: Optional[str] = None
    to_status: Optional[str] = None
    detail: Optional[str] = None
    # Field-level diff (for action='pipeline_field_edited' and similar)
    field_name: Optional[str] = None
    from_value: Optional[str] = None
    to_value: Optional[str] = None
    created_at: datetime


class AuditListResponse(BaseModel):
    items: list[AuditEvent]
    total: int
