"""Batch E + L-backend — model mirror + SiteResponse wire fields.

Covers:
  #134 sites.project_status / project_completed_at mapped + mirrored by writer
  #115 SiteResponse carries expected_loi_days / approved_at / approved_by / loi_uploaded_at
  #126 SiteResponse carries rejection_reason / archive_note
"""
from __future__ import annotations

import inspect
from datetime import datetime, timezone
from uuid import uuid4

from app.db import models
from app.services._common import site_to_response


# ── #134 — project mirror columns + writers ────────────────────────────────

def test_site_model_has_project_mirror_columns():
    cols = models.Site.__table__.columns
    assert "project_status" in cols
    assert "project_completed_at" in cols


def test_project_service_mirrors_status_to_sites():
    import app.services.project_service as ps

    src = inspect.getsource(ps)
    # Each project_status transition must also write the sites mirror.
    # ('budgeting' was removed when the budget moved to Project Excellence — #206.)
    assert 'site.project_status = "allocated"' in src
    assert 'site.project_status = "in_progress"' in src
    assert 'site.project_status = "done"' in src
    assert "site.project_completed_at" in src


# ── #115 + #126 — SiteResponse wire fields ─────────────────────────────────

def _make_site():
    site = models.Site()
    site.id = uuid4()
    site.tenant_id = uuid4()
    site.code = "BT-MUM-TEST"
    site.name = "Test Site"
    site.city = "Mumbai"
    site.status = "approved"
    site.submitted_by = uuid4()
    site.approved_at = datetime(2026, 6, 1, tzinfo=timezone.utc)
    site.loi_uploaded_at = datetime(2026, 6, 5, tzinfo=timezone.utc)
    site.rejection_reason = "footfall too low"
    site.archive_note = "parked until Q3"
    return site


def test_site_response_carries_sla_fields_from_approval():
    site = _make_site()
    approval = models.Approval()
    approval.expected_loi_days = 14
    approval.approver_id = uuid4()

    resp = site_to_response(
        site, created_by_name="Creator", approval=approval, approved_by_name="Supervisor Bob",
    )
    assert resp.expected_loi_days == 14
    assert resp.approved_at == site.approved_at
    assert resp.loi_uploaded_at == site.loi_uploaded_at
    assert resp.approved_by == "Supervisor Bob"


def test_site_response_sla_fields_default_without_approval():
    resp = site_to_response(_make_site())
    assert resp.expected_loi_days is None
    assert resp.approved_by is None


def test_site_response_carries_reject_archive_reason():
    resp = site_to_response(_make_site())
    assert resp.rejection_reason == "footfall too low"
    assert resp.archive_note == "parked until Q3"
