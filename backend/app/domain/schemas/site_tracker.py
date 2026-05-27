"""BD-facing read-only projection used by the Site Tracker tab.

Same underlying DD/agreement/licensing payloads as `BdSiteStatusResponse`,
just framed for the per-site node-diagram view. Lives in its own file so the
tracker contract can evolve independently from the change-request view.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel

from app.domain.schemas.legal import (
    AgreementResponse,
    DdChecklistResponse,
    LicensingResponse,
)


class SiteTrackerResponse(BaseModel):
    """Everything BD needs to render the Site Tracker detail page for one site."""

    site_id:          str
    site_code:        str
    site_name:        str
    city:             str
    site_status:      str
    legal_dd_status:  Optional[str] = None
    agreement_status: Optional[str] = None
    licensing_status: Optional[str] = None

    # Only published rows surface to BD. If U3 has not landed yet, the
    # backend treats absent `stage` columns as "published" (see service).
    dd:        Optional[DdChecklistResponse] = None
    agreement: Optional[AgreementResponse] = None
    licensing: Optional[LicensingResponse] = None

    submitted_by:      str
    submitted_by_name: Optional[str] = None
