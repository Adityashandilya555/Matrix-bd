"""Project module: GFC budget area/cover surfacing + initialization proposer.

Locks two fixes (no live DB — see conftest.py philosophy):

1. ``_build_response`` surfaces ``total_indoor_area_sqft`` / ``total_area_sqft`` /
   ``covers`` from the GFC ``SiteBudget``. They were never copied onto the
   response, so the Project module showed blank area inputs and "—" for every
   derived per-sqft / per-cover metric even though the data existed.

2. ``svc_propose_initialization`` lets a supervisor seed the initialization date
   from inside the Project module when the Project-Excellence handover left it
   'pending' (recovery path). Supervisor-only, and guarded so it can never
   clobber an in-flight proposed/approved/rejected exchange.
"""
from __future__ import annotations

import datetime as _dt
import uuid

import pytest
from fastapi import HTTPException

from app.db import models
from app.domain.schemas.project import InitializationProposeRequest
from app.services import project_service
from tests.conftest import RecordingSession


# ── builders ──────────────────────────────────────────────────────────────────

def _site(**kw):
    base = dict(
        id=uuid.uuid4(), tenant_id=uuid.uuid4(), status="in_project",
        name="poker", city="Bengaluru", submitted_by=uuid.uuid4(),
        ca_code="CA-406", design_status="approved",
    )
    base.update(kw)
    return models.Site(**base)


def _review(site, **kw):
    base = dict(
        tenant_id=site.tenant_id, site_id=site.id,
        project_status="pending", current_stage="execution",
        initialization_status="pending", expected_completion_status="pending",
        quality_audit_status="pending", nso_status="pending",
        updated_at=_dt.datetime(2026, 6, 15, 0, 0, 0),
    )
    base.update(kw)
    return models.ProjectReview(**base)


def _supervisor():
    return {"sub": str(uuid.uuid4()), "role": "supervisor", "name": "Sup"}


def _exec():
    return {"sub": str(uuid.uuid4()), "role": "executive", "name": "Exec"}


# ── 1. area & covers surfacing ──────────────────────────────────────────────────

async def test_build_response_surfaces_area_and_covers(monkeypatch):
    site = _site()
    review = _review(site)
    budget = models.SiteBudget(
        id=uuid.uuid4(), site_id=site.id, tenant_id=site.tenant_id, phase="gfc",
        status="approved", budget_total=83137974,
        total_indoor_area_sqft=4595, total_area_sqft=3999, covers=23,
    )

    async def _deleg(session, *, site_id):
        return None

    async def _name(session, uid):
        return "Submitter"

    async def _fetch_budget(session, *, site_id, phase, tenant_id):
        return budget

    async def _items(session, *, budget_id, tenant_id):
        return []

    monkeypatch.setattr(project_service, "_active_project_delegate", _deleg)
    monkeypatch.setattr(project_service, "fetch_user_name", _name)
    monkeypatch.setattr(project_service.budget_service, "fetch_budget", _fetch_budget)
    monkeypatch.setattr(project_service.budget_service, "budget_items", _items)

    resp = await project_service._build_response(RecordingSession(), site, review)

    # The whole point of the fix: these are no longer dropped.
    assert resp.total_indoor_area_sqft == 4595.0
    assert resp.total_area_sqft == 3999.0
    assert resp.covers == 23
    assert resp.budget_status == "approved"
    assert resp.budget_total == 83137974.0


async def test_build_response_area_none_without_budget(monkeypatch):
    site = _site()
    review = _review(site)

    async def _deleg(session, *, site_id):
        return None

    async def _name(session, uid):
        return "Submitter"

    async def _no_budget(session, *, site_id, phase, tenant_id):
        return None

    monkeypatch.setattr(project_service, "_active_project_delegate", _deleg)
    monkeypatch.setattr(project_service, "fetch_user_name", _name)
    monkeypatch.setattr(project_service.budget_service, "fetch_budget", _no_budget)

    resp = await project_service._build_response(RecordingSession(), site, review)

    assert resp.total_indoor_area_sqft is None
    assert resp.total_area_sqft is None
    assert resp.covers is None
    assert resp.budget_status == "draft"


# ── 2. initialization proposer (recovery path) ──────────────────────────────────

async def test_propose_initialization_is_supervisor_only(make_session):
    with pytest.raises(HTTPException) as ei:
        await project_service.svc_propose_initialization(
            make_session(), tenant_id=uuid.uuid4(), actor=_exec(),
            site_id=uuid.uuid4(),
            body=InitializationProposeRequest(value=_dt.date(2026, 7, 1)),
        )
    assert ei.value.status_code == 403


async def test_propose_initialization_seeds_when_pending(make_session, fake_result, monkeypatch):
    site = _site()
    review = _review(site, initialization_status="pending")
    sess = make_session(fake_result(scalar=site), fake_result(scalar=review))

    async def _resp(session, s, r):
        return "OK"

    monkeypatch.setattr(project_service, "_build_response", _resp)

    out = await project_service.svc_propose_initialization(
        sess, tenant_id=site.tenant_id, actor=_supervisor(), site_id=site.id,
        body=InitializationProposeRequest(value=_dt.date(2026, 7, 1)),
    )
    assert out == "OK"
    assert review.initialization_status == "proposed"
    assert review.initialization_date == _dt.date(2026, 7, 1)


async def test_propose_initialization_does_not_clobber_inflight(make_session, fake_result):
    site = _site()
    review = _review(site, initialization_status="approved",
                     initialization_date=_dt.date(2026, 1, 1))
    sess = make_session(fake_result(scalar=site), fake_result(scalar=review))

    with pytest.raises(HTTPException) as ei:
        await project_service.svc_propose_initialization(
            sess, tenant_id=site.tenant_id, actor=_supervisor(), site_id=site.id,
            body=InitializationProposeRequest(value=_dt.date(2026, 7, 1)),
        )
    assert ei.value.status_code == 422
    assert review.initialization_status == "approved"            # unchanged
    assert review.initialization_date == _dt.date(2026, 1, 1)    # unchanged
