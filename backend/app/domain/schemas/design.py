"""Pydantic schemas for the Design module workflow.

The design module is a PARALLEL track that opens once a site's DDR is positive
(sites.legal_dd_status == 'positive'). It does NOT mutate the linear site status;
progress is tracked by sites.design_status plus two child tables:

  design_reviews       — one row per site (current_stage + business_admin GFC gate)
  design_deliverables  — one row per (site, kind): recce | 2d | 3d | boq

Deliverable status:  'pending' | 'submitted' | 'approved' | 'rejected'
GFC status:          'pending' | 'approved' | 'rejected'
sites.design_status: 'pending' | 'allocated' | 'in_progress' | 'gfc_pending' | 'approved' | 'rejected'
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, field_validator

DeliverableKind = Literal["recce", "2d", "3d", "boq"]
DeliverableStatus = Literal["pending", "submitted", "approved", "rejected"]
DesignStage = Literal["recce", "2d", "3d", "boq", "gfc", "done"]
GfcStatus = Literal["pending", "approved", "rejected"]
ReviewDecision = Literal["approve", "reject"]


# ── Requests ──────────────────────────────────────────────────────────────────

class AllocateDesignRequest(BaseModel):
    """Supervisor allocates a finance-approved site to a design executive."""
    executive_id: str
    notes: Optional[str] = None


class SubmitDeliverableRequest(BaseModel):
    """Executive uploads / updates a deliverable (recce | 2d | 3d | boq).

    file_url + file_name describe the uploaded artifact. estimated_amount is
    only meaningful for kind='boq' (the BOQ estimated cost).
    """
    file_url: Optional[str] = None
    file_name: Optional[str] = None
    estimated_amount: Optional[float] = None


class ReviewDeliverableRequest(BaseModel):
    """Supervisor approves or rejects a submitted deliverable.

    `comments` are stored on the deliverable and shown to the executive — they
    are mandatory on reject so the re-upload loop has direction.
    """
    decision: ReviewDecision
    comments: Optional[str] = None

    @field_validator("comments")
    @classmethod
    def comments_required_on_reject(cls, v: Optional[str], info) -> Optional[str]:
        if info.data.get("decision") == "reject" and not (v and v.strip()):
            raise ValueError("comments are required when rejecting a deliverable")
        return v


class GfcDecisionRequest(BaseModel):
    """Business admin's Good-For-Construction decision (the admin gate).

    `comments` are visible to the design supervisor. Required on reject.
    """
    decision: ReviewDecision
    comments: Optional[str] = None

    @field_validator("comments")
    @classmethod
    def comments_required_on_reject(cls, v: Optional[str], info) -> Optional[str]:
        if info.data.get("decision") == "reject" and not (v and v.strip()):
            raise ValueError("comments are required when rejecting GFC")
        return v


# ── Responses ─────────────────────────────────────────────────────────────────

class DeliverableResponse(BaseModel):
    kind: DeliverableKind
    status: DeliverableStatus
    file_url: Optional[str] = None
    file_name: Optional[str] = None
    estimated_amount: Optional[float] = None
    supervisor_comments: Optional[str] = None
    submitted_by: Optional[str] = None
    submitted_at: Optional[datetime] = None
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    admin_status: str = "pending"            # 2D/3D second-tier (business_admin) gate
    admin_comments: Optional[str] = None
    download_url: Optional[str] = None       # short-lived signed URL for the uploaded file
    updated_at: Optional[datetime] = None


class DesignReviewResponse(BaseModel):
    """Full design state for a site — the folder + all deliverables + GFC."""
    site_id: str
    site_code: Optional[str] = None
    site_name: Optional[str] = None
    city: Optional[str] = None
    submitted_by_name: Optional[str] = None
    tenant_id: str
    site_status: str                      # current linear sites.status (untouched by design)
    design_status: Optional[str] = None   # sites.design_status mirror
    legal_dd_status: Optional[str] = None # the gate this module opened behind
    current_stage: DesignStage = "recce"
    gfc_status: GfcStatus = "pending"
    gfc_comments: Optional[str] = None
    gfc_decided_at: Optional[datetime] = None
    deliverables: list[DeliverableResponse] = []


class DesignQueueItem(BaseModel):
    """Lightweight row shown in the Design queue list."""
    site_id: str
    site_code: str
    site_name: str
    city: str
    design_status: str                    # sites.design_status mirror
    current_stage: Optional[DesignStage] = None
    legal_dd_status: str
    allocated_to_name: Optional[str] = None
    submitted_by_name: Optional[str] = None


class DesignQueueResponse(BaseModel):
    items: list[DesignQueueItem]
    total: int


class DesignGfcQueueItem(BaseModel):
    """Row in the business_admin GFC queue (sites awaiting Good-For-Construction)."""
    site_id: str
    site_code: str
    site_name: str
    city: str
    boq_estimated_amount: Optional[float] = None
    submitted_by_name: Optional[str] = None


class DesignGfcQueueResponse(BaseModel):
    items: list[DesignGfcQueueItem]
    total: int


# ── Admin 2D/3D approval queue (grouped by site) ─────────────────────────────

class AdminReviewDeliverableRequest(BaseModel):
    """Business admin's decision on a supervisor-approved 2D/3D deliverable."""
    decision: ReviewDecision
    comments: Optional[str] = None

    @field_validator("comments")
    @classmethod
    def comments_required_on_reject(cls, v: Optional[str], info) -> Optional[str]:
        if info.data.get("decision") == "reject" and not (v and v.strip()):
            raise ValueError("comments are required when sending a deliverable back")
        return v


class AdminQueueDeliverable(BaseModel):
    kind: DeliverableKind
    status: DeliverableStatus
    file_name: Optional[str] = None
    download_url: Optional[str] = None
    submitted_at: Optional[datetime] = None


class DesignAdminQueueSite(BaseModel):
    site_id: str
    site_code: str
    site_name: str
    city: str
    deliverables: list[AdminQueueDeliverable] = []


class DesignAdminQueueResponse(BaseModel):
    items: list[DesignAdminQueueSite]
    total: int
