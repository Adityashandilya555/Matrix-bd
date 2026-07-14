"""Supervisor edits an executive's details — audit-derived highlight flow.

Locks the behaviour behind the yellow site flag + per-field eye highlight
(no live DB; see conftest.py philosophy):

1. `compute_unseen_supervisor_edits` returns only supervisor-edited fields that
   post-date the executive's most recent view marker.
2. `svc_save_details` tags the diff as a supervisor edit when the actor is a
   supervisor, and as a normal executive edit otherwise.
3. `svc_mark_details_viewed` writes the "seen" marker only when there is
   something unseen, so the activity feed isn't spammed on every open.
"""
from __future__ import annotations

import datetime as dt
import uuid

import pytest
from fastapi import HTTPException

from app.db import models
from app.domain.state_machine import SiteStatus
from app.services import bd_service
from app.services._common import compute_unseen_supervisor_edits
from app.services.audit_service import EXEC_VIEWED_ACTION, SUPERVISOR_EDIT_ACTION
from tests.conftest import FakeResult, RecordingSession

pytestmark = pytest.mark.asyncio

TENANT = uuid.uuid4()
T0 = dt.datetime(2026, 7, 14, 10, 0, 0)


def _supervisor(sub=None):
    return {"sub": str(sub or uuid.uuid4()), "role": "supervisor", "name": "Sup"}


def _executive(sub=None):
    return {"sub": str(sub or uuid.uuid4()), "role": "executive", "name": "Exec"}


def _site(**kw):
    base = dict(
        id=uuid.uuid4(), tenant_id=TENANT, status="shortlisted",
        name="x", city="Pune", submitted_by=uuid.uuid4(),
        model=None, spoc_name=None, google_maps_pin=None,
        expected_rent=None, rent_type=None, area_sqft=0,
    )
    base.update(kw)
    return models.Site(**base)


# ── 1. unseen computation ──────────────────────────────────────────────────

async def test_unseen_edits_respect_view_marker():
    unseen_site = uuid.uuid4()   # edited, never viewed
    seen_site = uuid.uuid4()     # edited then viewed
    reedit_site = uuid.uuid4()   # edited, viewed, edited again
    rows = [
        (unseen_site, SUPERVISOR_EDIT_ACTION, "rent_type", T0),
        (seen_site, SUPERVISOR_EDIT_ACTION, "expected_rent", T0),
        (seen_site, EXEC_VIEWED_ACTION, None, T0 + dt.timedelta(minutes=5)),
        (reedit_site, SUPERVISOR_EDIT_ACTION, "model", T0),
        (reedit_site, EXEC_VIEWED_ACTION, None, T0 + dt.timedelta(minutes=5)),
        (reedit_site, SUPERVISOR_EDIT_ACTION, "spoc_name", T0 + dt.timedelta(minutes=10)),
    ]
    session = RecordingSession([FakeResult(all_rows=rows)])
    out = await compute_unseen_supervisor_edits(
        session, tenant_id=TENANT, site_ids=[unseen_site, seen_site, reedit_site],
    )
    assert out == {unseen_site: ["rent_type"], reedit_site: ["spoc_name"]}


async def test_unseen_edits_empty_for_no_ids():
    out = await compute_unseen_supervisor_edits(RecordingSession(), tenant_id=TENANT, site_ids=[])
    assert out == {}


# ── 2. edit tagging by role ────────────────────────────────────────────────

async def _run_save_details(monkeypatch, actor, site):
    captured = {}

    async def _fake_diff(session, **kw):
        captured["action"] = kw.get("action")
        captured["actor_role"] = kw.get("actor_role")
        return 1

    async def _fake_upsert(*a, **k):
        return None

    async def _fetch(session, *, site_id, tenant_id):
        return site

    monkeypatch.setattr(bd_service, "diff_and_log_pipeline_fields", _fake_diff)
    monkeypatch.setattr(bd_service, "_upsert_site_details", _fake_upsert)
    monkeypatch.setattr(bd_service, "fetch_site_for_update_or_404", _fetch)
    await bd_service.svc_save_details(
        RecordingSession(), tenant_id=TENANT, actor=actor, site_id=site.id,
        details={"rent": 123000, "rent_type": "fixed"},
    )
    return captured


async def test_supervisor_edit_is_tagged(monkeypatch):
    site = _site()
    captured = await _run_save_details(monkeypatch, _supervisor(), site)
    assert captured["action"] == SUPERVISOR_EDIT_ACTION
    assert captured["actor_role"] == "supervisor"


async def test_executive_edit_is_not_tagged(monkeypatch):
    me = uuid.uuid4()
    site = _site(submitted_by=me)
    captured = await _run_save_details(monkeypatch, _executive(me), site)
    assert captured["action"] == "pipeline_field_edited"


# ── 3. view marker only written when there is something unseen ──────────────

async def _run_mark_viewed(monkeypatch, unseen_map, site):
    wrote = []

    async def _unseen(session, *, tenant_id, site_ids):
        return unseen_map

    async def _fake_write(session, **kw):
        wrote.append(kw.get("action"))
        return None

    async def _fetch(session, *, site_id, tenant_id):
        return site

    monkeypatch.setattr(bd_service, "compute_unseen_supervisor_edits", _unseen)
    monkeypatch.setattr(bd_service, "write_audit_event", _fake_write)
    monkeypatch.setattr(bd_service, "fetch_site_for_update_or_404", _fetch)
    await bd_service.svc_mark_details_viewed(
        RecordingSession(), tenant_id=TENANT, actor=_executive(), site_id=site.id,
    )
    return wrote


async def test_mark_viewed_writes_when_unseen(monkeypatch):
    site = _site()
    wrote = await _run_mark_viewed(monkeypatch, {site.id: ["rent_type"]}, site)
    assert wrote == [EXEC_VIEWED_ACTION]


async def test_mark_viewed_noop_when_nothing_unseen(monkeypatch):
    site = _site()
    wrote = await _run_mark_viewed(monkeypatch, {}, site)
    assert wrote == []


# ── 4. edit-after-submit is executive-forbidden (Problem 1) ─────────────────

async def test_executive_cannot_edit_after_submit():
    """Once submitted for review the executive can no longer edit — 403."""
    me = uuid.uuid4()
    site = _site(status=SiteStatus.DETAILS_SUBMITTED.value, submitted_by=me)
    with pytest.raises(HTTPException) as exc:
        bd_service._assert_can_edit_details(_executive(me), site)
    assert exc.value.status_code == 403


async def test_executive_can_edit_while_shortlisted():
    """Before submission (SHORTLISTED) the owning executive may still edit."""
    me = uuid.uuid4()
    site = _site(status=SiteStatus.SHORTLISTED.value, submitted_by=me)
    bd_service._assert_can_edit_details(_executive(me), site)  # must not raise


async def test_supervisor_can_edit_after_submit():
    """Supervisors keep edit rights at any stage, including DETAILS_SUBMITTED."""
    site = _site(status=SiteStatus.DETAILS_SUBMITTED.value)
    bd_service._assert_can_edit_details(_supervisor(), site)  # must not raise


# ── 5. name/city propagate through save-details (Problem 3) ─────────────────

async def test_save_details_updates_name_and_city(monkeypatch):
    """Editing name/city in Add Details writes them back onto the site row."""
    me = uuid.uuid4()
    site = _site(status=SiteStatus.SHORTLISTED.value, submitted_by=me, name="Old", city="Pune")

    async def _fetch(session, *, site_id, tenant_id):
        return site

    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(bd_service, "fetch_site_for_update_or_404", _fetch)
    monkeypatch.setattr(bd_service, "diff_and_log_pipeline_fields", _noop)
    monkeypatch.setattr(bd_service, "_upsert_site_details", _noop)

    await bd_service.svc_save_details(
        RecordingSession(), tenant_id=TENANT, actor=_executive(me), site_id=site.id,
        details={"name": "Bandra Flagship", "city": "Mumbai"},
    )
    assert site.name == "Bandra Flagship"
    assert site.city == "Mumbai"
