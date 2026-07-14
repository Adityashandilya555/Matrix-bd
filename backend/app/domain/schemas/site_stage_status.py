"""Read-only per-stage status projection for the BD process-flow view.

This powers the "View status" popup and the clickable pipeline nodes on the BD
site tracker. It is a pure *visibility* surface — no action fields, no writes.
It reuses the existing cross-module foreign-key tables (design_deliverables,
project_reviews, nso_reviews, site_agreement, site_licensing) plus the
stage_events audit trail so BD can see what each downstream module has done
(recce / 2D / 3D / BOQ, quality audit, licensing, etc.) without any of that
module's editing controls.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class StageStatusRow(BaseModel):
    """A single labelled sub-status inside a stage (e.g. "Recce" -> "Approved")."""
    label: str
    value: str
    # Coarse tone hint so the client renders a consistent colour without
    # re-deriving semantics from free-text values.
    tone: str = "neutral"  # neutral | positive | active | negative


class StageBlock(BaseModel):
    id: str                       # loi | legal | ca | design | project | nso | launch
    title: str
    state: str                    # complete | active | future | rejected
    state_label: str              # DONE | OPEN | PENDING | QUEUED | REJECTED | COMPLETE
    rows: list[StageStatusRow] = []
    note: Optional[str] = None


class StageTimelineEntry(BaseModel):
    event_type: str
    from_status: Optional[str] = None
    to_status: Optional[str] = None
    actor_role: Optional[str] = None
    actor_name: Optional[str] = None
    occurred_at: datetime


class SiteStageStatusResponse(BaseModel):
    site_id: str
    site_code: str
    site_name: str
    city: Optional[str] = None
    headline: str
    stages: list[StageBlock] = []
    timeline: list[StageTimelineEntry] = []
