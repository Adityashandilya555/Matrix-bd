"""Revoke → re-allocation correctness for Project and Project Excellence.

Locks the #419 follow-up fixes. Revoke intentionally only stamps
``revoked_at`` on the delegation row; it leaves the stored
``review.allocated_to`` / ``budget.allocated_to`` column set. The module state
must therefore derive ``allocated_to`` (and the PE ``excellence_status`` chip)
from the *live* non-revoked delegation, not that stale column — otherwise the
queue/overview and the re-allocation UI keep showing a revoked executive as
still allocated. Mirrors the pattern already shipped in
``financial_closure_service``.

No live DB — the state builders are exercised with their delegate/name/budget
helpers monkeypatched (see conftest.py philosophy).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from app.db import models
from app.services import project_excellence_service, project_service
from tests.conftest import RecordingSession

TENANT = uuid.uuid4()


def _site(**kw):
    base = dict(
        id=uuid.uuid4(), tenant_id=TENANT, status="in_project",
        name="poker", city="Bengaluru", submitted_by=uuid.uuid4(),
        ca_code="CA-406", design_status="approved", project_status="allocated",
    )
    base.update(kw)
    return models.Site(**base)


async def _name(*a, **k):
    return "Someone"


def _project_review(site):
    return models.ProjectReview(
        tenant_id=TENANT, site_id=site.id,
        allocated_to=uuid.uuid4(),          # stale: revoke leaves this set
        project_status="allocated", current_stage="execution",
        initialization_status="pending", expected_completion_status="pending",
        quality_audit_status="pending", nso_status="pending",
        updated_at=datetime.now(timezone.utc),
    )


def _pe_budget(site):
    return models.SiteBudget(
        id=uuid.uuid4(), site_id=site.id, tenant_id=TENANT, phase="gfc",
        status="draft", allocated_to=uuid.uuid4(),   # stale
        budget_total=None, updated_at=datetime.now(timezone.utc),
    )


# ── Project Excellence: _excellence_status is live-delegation driven ──────────

def test_excellence_status_pending_when_no_delegate_and_no_budget():
    assert project_excellence_service._excellence_status(None, has_delegate=False) == "pending"


def test_excellence_status_allocated_only_from_live_delegate():
    b = models.SiteBudget(id=uuid.uuid4(), site_id=uuid.uuid4(), tenant_id=TENANT, phase="gfc", status="draft")
    assert project_excellence_service._excellence_status(b, has_delegate=True) == "allocated"


def test_excellence_status_ignores_stale_allocated_to_after_revoke():
    # Revoke drops the delegation but leaves budget.allocated_to set. The chip
    # must fall back to 'pending', not stay stuck on 'allocated' (#419).
    b = models.SiteBudget(
        id=uuid.uuid4(), site_id=uuid.uuid4(), tenant_id=TENANT, phase="gfc",
        status="draft", allocated_to=uuid.uuid4(), budget_total=None,
    )
    assert project_excellence_service._excellence_status(b, has_delegate=False) == "pending"


def test_excellence_status_budgeting_when_executive_started_budget():
    # 'started entering budget' == budget_total is no longer NULL (set by the
    # first savePEBudget → replace_budget_items). This intentionally keeps the
    # re-allocate dropdown hidden even after a revoke, and must be preserved.
    b = models.SiteBudget(
        id=uuid.uuid4(), site_id=uuid.uuid4(), tenant_id=TENANT, phase="gfc",
        status="draft", budget_total=0.0,
    )
    assert project_excellence_service._excellence_status(b, has_delegate=False) == "budgeting"


def test_excellence_status_approved_wins():
    b = models.SiteBudget(id=uuid.uuid4(), site_id=uuid.uuid4(), tenant_id=TENANT, phase="gfc", status="approved")
    assert project_excellence_service._excellence_status(b, has_delegate=False) == "approved"


# ── Project: _build_response reports the live delegate, not the stale column ──

async def test_project_state_reports_none_allocated_after_revoke(monkeypatch):
    site = _site()
    review = _project_review(site)

    async def _no_delegate(session, *, site_id):
        return None

    async def _no_budget(session, *, site_id, tenant_id):
        return None, []

    monkeypatch.setattr(project_service, "_active_project_delegate", _no_delegate)
    monkeypatch.setattr(project_service, "_gfc_budget_lines", _no_budget)
    monkeypatch.setattr(project_service, "fetch_user_name", _name)

    resp = await project_service._build_response(RecordingSession(), site, review)
    assert resp.allocated_to is None
    assert resp.allocated_to_name is None


async def test_project_state_reports_live_delegate_when_allocated(monkeypatch):
    site = _site()
    review = _project_review(site)
    exec_id = uuid.uuid4()

    async def _delegate(session, *, site_id):
        return (exec_id, "Alex Exec", "alex@x.co")

    async def _no_budget(session, *, site_id, tenant_id):
        return None, []

    monkeypatch.setattr(project_service, "_active_project_delegate", _delegate)
    monkeypatch.setattr(project_service, "_gfc_budget_lines", _no_budget)
    monkeypatch.setattr(project_service, "fetch_user_name", _name)

    resp = await project_service._build_response(RecordingSession(), site, review)
    assert resp.allocated_to == str(exec_id)
    assert resp.allocated_to_name == "Alex Exec"


# ── Project Excellence: _build_response reports the live delegate ─────────────

async def test_pe_state_reports_none_allocated_after_revoke(monkeypatch):
    site = _site()
    budget = _pe_budget(site)

    async def _no_delegate(session, *, site_id):
        return None

    async def _no_items(session, *, budget):
        return []

    monkeypatch.setattr(project_excellence_service, "_active_pe_delegate", _no_delegate)
    monkeypatch.setattr(project_excellence_service, "_budget_item_out", _no_items)
    monkeypatch.setattr(project_excellence_service, "fetch_user_name", _name)

    resp = await project_excellence_service._build_response(RecordingSession(), site, budget)
    assert resp.allocated_to is None
    assert resp.allocated_to_name is None
    assert resp.excellence_status == "pending"


async def test_pe_state_reports_live_delegate_when_allocated(monkeypatch):
    site = _site()
    budget = _pe_budget(site)
    exec_id = uuid.uuid4()

    async def _delegate(session, *, site_id):
        return (exec_id, "Alex Exec", "alex@x.co")

    async def _no_items(session, *, budget):
        return []

    monkeypatch.setattr(project_excellence_service, "_active_pe_delegate", _delegate)
    monkeypatch.setattr(project_excellence_service, "_budget_item_out", _no_items)
    monkeypatch.setattr(project_excellence_service, "fetch_user_name", _name)

    resp = await project_excellence_service._build_response(RecordingSession(), site, budget)
    assert resp.allocated_to == str(exec_id)
    assert resp.allocated_to_name == "Alex Exec"
    assert resp.excellence_status == "allocated"
