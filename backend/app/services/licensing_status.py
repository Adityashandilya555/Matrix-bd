"""Canonical legal-licensing derivation, shared by the NSO module and the
business-admin launch review.

The legal ``site_licensing`` row is the single source of truth for the five
license statuses (FSSAI, health-trade, shops & establishment, fire NOC, storage).
The ``nso_reviews.*_status`` columns are NEVER synced from licensing (#229), so
any view of these statuses must derive from the ``SiteLicensing`` snapshot here —
never read the NsoReview row. NSO already does this; the business-admin review
(``launch_service``) must use the same derivation so the two agree.

Pure functions, no I/O — callers pass already-loaded ORM rows.
"""
from __future__ import annotations

from typing import Optional

from app.db import models

# The five legal licensing columns on ``site_licensing`` (each
# "yes"/"no"/"pending"/"na", where "na" = not applicable to this site).
LEGAL_LICENSE_FIELDS: tuple[str, ...] = (
    "fssai",
    "health_trade",
    "shops_estab_reg",
    "fire_noc",
    "storage_license",
)

# Status field (as exposed on the NSO Stage-2 / launch DepartmentStatuses shape)
# → the canonical SiteLicensing column it reflects.
STAGE_TWO_STATUS_TO_LICENSE: dict[str, str] = {
    "fssai_status": "fssai",
    "health_trade_status": "health_trade",
    "shops_estab_status": "shops_estab_reg",
    "fire_noc_status": "fire_noc",
    "storage_license_status": "storage_license",
}


def legal_license_values(licensing: Optional[models.SiteLicensing]) -> dict[str, str]:
    """Raw per-license values ("yes"/"no"/"pending") from the licensing row."""
    if licensing is None:
        return dict.fromkeys(LEGAL_LICENSE_FIELDS, "pending")
    return {field: (getattr(licensing, field) or "pending") for field in LEGAL_LICENSE_FIELDS}


def legal_licensing_complete(
    site: models.Site, licensing: Optional[models.SiteLicensing],
) -> bool:
    """True only when the licensing rollup is complete and every license is
    resolved — "yes" or "na" (not applicable). A license that does not apply to
    a site must not hold completion back."""
    values = legal_license_values(licensing)
    return bool(
        licensing
        and (site.licensing_status or "pending") == "complete"
        and all(value in ("yes", "na") for value in values.values())
    )


def legacy_done(value: str) -> str:
    """Map a raw licensing value to the legacy done/pending the *_status fields
    use. A resolved license ("yes" or "na") reads as "done" so an N/A item does
    not leave the NSO Stage-2 progress stuck on "pending"."""
    return "done" if value in ("yes", "na") else "pending"


def stage_two_canonical_status(
    licensing: Optional[models.SiteLicensing],
) -> dict[str, str]:
    """The five ``*_status`` fields derived from canonical Legal Licensing —
    ``legacy_done()`` of each licensing value. NEVER reads ``NsoReview.*_status``
    (which is never synced and would always read "pending", #229)."""
    values = legal_license_values(licensing)
    return {
        status_field: legacy_done(values[license_field])
        for status_field, license_field in STAGE_TWO_STATUS_TO_LICENSE.items()
    }
