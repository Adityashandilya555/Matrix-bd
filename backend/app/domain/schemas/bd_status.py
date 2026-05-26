"""BD-facing read-only view of a site's legal & licensing status.

Same underlying data as LegalReviewResponse, but framed for the BD side and
includes the open change requests the BD person filed (or that legal is
processing) on this site.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel

from app.domain.schemas.legal import (
    AgreementResponse,
    DdChecklistResponse,
    LicensingResponse,
)
from app.domain.schemas.legal_change_request import ChangeRequestResponse


class BdSiteStatusResponse(BaseModel):
    """Everything BD needs to render the 'View status' page for one site."""
    site_id:        str
    site_code:      str
    site_name:      str
    city:           str
    site_status:    str
    legal_dd_status:  Optional[str] = None
    agreement_status: Optional[str] = None
    licensing_status: Optional[str] = None

    dd:        Optional[DdChecklistResponse] = None
    agreement: Optional[AgreementResponse] = None
    licensing: Optional[LicensingResponse] = None  # null until DD is positive

    submitted_by:      str
    submitted_by_name: Optional[str] = None

    change_requests: list[ChangeRequestResponse] = []


class DdFailedSiteItem(BaseModel):
    """Row for the 'Due diligence failed' BD tab."""
    site_id:      str
    site_code:    str
    site_name:    str
    city:         str
    submitted_by_name: Optional[str] = None
    rejection_reason:  Optional[str] = None
    legal_rejected_at: Optional[datetime] = None


class DdFailedListResponse(BaseModel):
    items: list[DdFailedSiteItem]
    total: int
