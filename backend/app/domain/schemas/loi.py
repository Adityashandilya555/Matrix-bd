"""Pydantic schemas for LOI resources."""
from __future__ import annotations
from datetime import date
from typing import Optional
from pydantic import BaseModel


class SetLOITimelineRequest(BaseModel):
    expected_loi_days: int


class LOIUploadResponse(BaseModel):
    site_id: str
    loi_uploaded: bool
    loi_uploaded_at: Optional[date] = None
    days_to_loi: Optional[int] = None


class SendBackLOIRequest(BaseModel):
    comments: str


class LOIViewResponse(BaseModel):
    site_id: str
    # Short-lived (300s) Supabase signed URL. Null ONLY when no LOI has been
    # uploaded yet — a stored file whose URL cannot be signed raises 503.
    file_url: Optional[str] = None
    uploaded_at: Optional[date] = None
    uploaded_by: Optional[str] = None
