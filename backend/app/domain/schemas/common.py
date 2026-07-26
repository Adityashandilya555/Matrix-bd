"""Shared Pydantic models."""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class OkResponse(BaseModel):
    ok: bool = True
    message: str = "success"


class ReversibleActionItem(BaseModel):
    """One still-undoable action, keyed to the audit entry the UI renders.

    `audit_log_id` is what the client matches against its audit feed to decide
    which entry gets an Undo button — deliberately kept out of the shared
    AuditEvent schema, which several read paths consume. Lives here (not in a
    module schema) because reversible actions now span BD approval and design.
    """
    id: str
    audit_log_id: Optional[str] = None
    action: str
    entity_type: str
    created_at: datetime


class ReversibleActionListResponse(BaseModel):
    items: list[ReversibleActionItem]
    total: int


class ErrorResponse(BaseModel):
    detail: str
