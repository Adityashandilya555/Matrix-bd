"""What Matrix sends to the NSO platform, and when.

Two registries live here and a test keeps them in step:

* ``WATCHED`` — which model attributes trigger an event when they change.
* ``build_snapshot`` — which values go into the payload, and from where.

Adding a field: add its source attribute to ``WATCHED``, add it to the snapshot,
add it to the field table in ``docs/16-nso-integration/receiver.md``. Never send
``tenants.workspace_code`` (it is a login credential), ``spoc_email``, phone
numbers or commercial terms.

All functions take a *sync* ``Session``: the capture hooks run inside the sync
session behind ``AsyncSession``, and async callers use ``db.run_sync(...)``.
"""
from __future__ import annotations

import re
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import models

INTEGRATION = "nso_platform"
SCHEMA_VERSION = "1"

EVENT_UPDATED = "site.updated"
EVENT_DELETED = "site.deleted"
EVENT_TEST = "site.test"

# Model → attributes whose change queues a fresh snapshot of the site.
WATCHED: dict[type, frozenset[str]] = {
    models.Site: frozenset({
        "name", "city", "model", "google_maps_pin", "google_maps_url",
        "ca_code", "finance_status", "loi_uploaded_at", "launched_at", "archived_at", "status",
    }),
    models.SiteLicensing: frozenset({"fssai", "stage"}),
    models.ProjectReview: frozenset({"initialization_date", "initialization_status", "pushed_to_nso_at"}),
    models.NsoReview: frozenset({"launch_date"}),
}

_PIN = re.compile(r"^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$")


def parse_pin(raw: Optional[str]) -> tuple[Optional[float], Optional[float]]:
    """``"12.97, 77.64"`` → ``(12.97, 77.64)``; anything else → ``(None, None)``."""
    match = _PIN.match(raw or "")
    if not match:
        return None, None
    lat, lng = float(match[1]), float(match[2])
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None, None
    return lat, lng


def shared_cafe_code(ca_code: Optional[str], finance_status: Optional[str]) -> Optional[str]:
    """The cafe code NSO may see: only once Finance has approved it.

    ``sites.ca_code`` is also written by executives' finance *drafts* while
    ``finance_status`` is still pending, so the raw column must not leak.
    """
    return ca_code if ca_code and finance_status == "approved" else None


def is_eligible(cafe_code: Optional[str]) -> bool:
    """Whether a site is shared with the NSO platform at all.

    v1 rule: it has a Finance-approved cafe code (see ``shared_cafe_code``).
    Changing the rule means changing these two functions, then a backfill.
    """
    return bool(cafe_code)


def _iso(value: date | datetime | None) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    return value.isoformat()


# India has no DST, so a fixed offset is exact and needs no tz database.
IST = timezone(timedelta(hours=5, minutes=30))


def _day(value: Optional[datetime]) -> Optional[str]:
    """Calendar date in IST (a 01:00 IST push is that day, not the UTC day before)."""
    return value.astimezone(IST).date().isoformat() if value else None


def build_snapshot(session: Session, site_id: uuid.UUID) -> Optional[dict[str, Any]]:
    """Full snapshot of one site for the payload, or ``None`` if the site is gone.

    Reads columns with plain SELECTs (after the caller has flushed), so it sees
    this transaction's own changes and never loads or expires ORM objects.
    """
    s = models.Site
    row = session.execute(
        select(
            s.id, s.tenant_id, s.name, s.city, s.model, s.status, s.archived_at,
            s.ca_code, s.finance_status, s.google_maps_pin, s.google_maps_url, s.loi_uploaded_at, s.launched_at,
            models.Tenant.name.label("tenant_name"),
        )
        .join(models.Tenant, models.Tenant.id == s.tenant_id)
        .where(s.id == site_id)
    ).first()
    if row is None:
        return None

    licence = session.execute(
        select(models.SiteLicensing.fssai, models.SiteLicensing.stage).where(models.SiteLicensing.site_id == site_id)
    ).first()
    # Only Legal-published values: executives' drafts (stage draft /
    # pending_review) are unreviewed. Published rows never return to draft.
    fssai = licence.fssai if licence and licence.stage == "published" else None
    pr = models.ProjectReview
    project = session.execute(
        select(pr.initialization_date, pr.initialization_status, pr.pushed_to_nso_at).where(pr.site_id == site_id)
    ).first()
    live_planned = session.execute(
        select(models.NsoReview.launch_date).where(models.NsoReview.site_id == site_id)
    ).scalar_one_or_none()

    lat, lng = parse_pin(row.google_maps_pin)
    project_start = (
        project.initialization_date
        if project and project.initialization_status == "approved"
        else None
    )
    return {
        "company": {"id": str(row.tenant_id), "name": row.tenant_name},
        "site": {
            "id": str(row.id),
            "cafe_code": shared_cafe_code(row.ca_code, row.finance_status),
            "name": row.name,
            "city": row.city,
            "model": row.model,
            "status": row.status,
            "archived": row.archived_at is not None,
            "google_pin": row.google_maps_pin,
            "lat": lat,
            "lng": lng,
            "google_maps_url": row.google_maps_url,
            # No source in Matrix yet (open question 2): always null in v1.
            "work_email": None,
        },
        "loi": {"uploaded": row.loi_uploaded_at is not None, "uploaded_at": _iso(row.loi_uploaded_at)},
        # Canonical licence status lives in site_licensing (legal module);
        # nso_reviews.fssai_status is never synced, so it is not used.
        "licences": {"fssai_status": fssai},
        "dates": {
            "project_start": _iso(project_start),
            "handover": _day(project.pushed_to_nso_at) if project else None,
            "live_planned": _iso(live_planned),
            "live_actual": _day(row.launched_at),
        },
    }


def tombstone(tenant_id: uuid.UUID, site_id: uuid.UUID, cafe_code: Optional[str], name: Optional[str]) -> dict[str, Any]:
    """Payload for ``site.deleted``: just enough for NSO to find and drop the site."""
    return {
        "company": {"id": str(tenant_id)},
        "site": {"id": str(site_id), "cafe_code": cafe_code, "name": name},
        "deleted": True,
    }


def sample_payload(tenant_id: uuid.UUID, tenant_name: str) -> dict[str, Any]:
    """Payload for the admin's "send test" button. The site id is all zeros."""
    return {
        "company": {"id": str(tenant_id), "name": tenant_name},
        "site": {"id": str(uuid.UUID(int=0)), "name": "Matrix test event"},
        "test": True,
    }
