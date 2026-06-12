"""Launch validation-loop service tests (migration 202606121 / launch_service).

Validates the parts the feature cares about WITHOUT a live DB (see conftest.py
philosophy): the rent-only edit diff, the final commit field mapping, and the
FSM / role guards. Each guard test only needs the queued results consumed before
the guard fires, so they stay robust.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.db import models
from app.domain.schemas.launch import (
    RENT_EDITABLE_FIELDS,
    LaunchCommentRequest,
    LaunchRentFieldsRequest,
    LaunchReviewRequest,
)
from app.services import launch_service as L


# ── builders ─────────────────────────────────────────────────────────────────────

def _site(**kw):
    base = dict(
        id=uuid.uuid4(), tenant_id=uuid.uuid4(), status="pushed_to_payments",
        name="Powai · Lake Homes", city="Mumbai", submitted_by=uuid.uuid4(),
    )
    base.update(kw)
    return models.Site(**base)


def _appr(site, **kw):
    base = dict(id=uuid.uuid4(), site_id=site.id, tenant_id=site.tenant_id, status="pending_admin_review")
    base.update(kw)
    return models.LaunchApproval(**base)


def _admin():
    return {"sub": str(uuid.uuid4()), "role": "business_admin", "name": "Admin"}


# ── rent-only edit set ─────────────────────────────────────────────────────────────

def test_rent_editable_set_is_rent_only():
    # Editable: rent terms + lock-in + tenure.
    for f in ("rent_type", "expected_rent", "rev_share_pct", "escalation_pct",
              "expected_escalation_years", "rent_free_days", "lock_in_months", "tenure_months"):
        assert f in RENT_EDITABLE_FIELDS
    # NOT editable: every other commercial field stays read-only.
    for f in ("cam_charges", "security_deposit", "brokerage", "capex",
              "carpet_area_sqft", "score", "estimated_monthly_sales", "notes"):
        assert f not in RENT_EDITABLE_FIELDS


def test_apply_rent_edits_emits_diff_only_for_changes():
    row = models.LaunchApproval(
        id=uuid.uuid4(), site_id=uuid.uuid4(), tenant_id=uuid.uuid4(),
        status="pending_admin_review", rent_type="fixed", expected_rent=100000.0, escalation_pct=5.0,
    )
    body = LaunchRentFieldsRequest(rent_type="fixed", expected_rent=120000, escalation_pct=5)
    changes = L._apply_rent_edits(row, body)

    # rent_type + escalation unchanged → only expected_rent is a diff.
    assert {c["field"] for c in changes} == {"expected_rent"}
    assert row.expected_rent == 120000
    ch = changes[0]
    assert ch["from"] == "100000" and ch["to"] == "120000"  # integral floats render clean
    assert ch["label"]  # human label present for the timeline


def test_apply_rent_edits_noop_returns_empty():
    row = models.LaunchApproval(
        id=uuid.uuid4(), site_id=uuid.uuid4(), tenant_id=uuid.uuid4(),
        status="pending_admin_review", rent_type="revshare", rev_share_pct=12.0,
    )
    assert L._apply_rent_edits(row, LaunchRentFieldsRequest(rev_share_pct=12)) == []


# ── final commit field mapping ─────────────────────────────────────────────────────

def test_commit_writes_canonical_columns():
    site = _site()
    detail = models.SiteDetail(id=uuid.uuid4(), site_id=site.id, tenant_id=site.tenant_id)
    row = _appr(
        site, status="pending_admin_final", rent_type="mg_revshare",
        expected_rent=80000.0, fixed_rent_amt=None, rev_share_pct=12.0,
        escalation_pct=4.0, expected_escalation_years=3,
        rent_free_days=30, lock_in_months=36, tenure_months=60,
    )
    L._commit_rent_to_canonical(site, detail, row)

    # sites mirror
    assert site.rent_type == "mg_revshare"
    assert site.expected_rent == 80000.0
    assert site.expected_revshare_pct == 12.0
    assert site.expected_escalation_pct == 4.0
    assert site.expected_escalation_years == 3
    assert site.rent_set_at is not None
    # site_details detail — fixed_rent_amt falls back to expected_rent when unset
    assert detail.fixed_rent_amt == 80000.0
    assert detail.rev_share_pct == 12.0
    assert detail.rent_free_days == 30
    assert detail.lock_in_months == 36
    assert detail.tenure_months == 60


# ── verdict validation (raises before any DB access) ───────────────────────────────

async def test_exec_review_rejects_invalid_verdict(make_session):
    with pytest.raises(HTTPException) as ei:
        await L.svc_exec_review(
            make_session(), tenant_id=uuid.uuid4(),
            actor={"sub": str(uuid.uuid4()), "role": "executive", "name": "E"},
            site_id=uuid.uuid4(), body=LaunchReviewRequest(verdict="maybe"),
        )
    assert ei.value.status_code == 422


async def test_exec_review_requires_comment_on_reject(make_session):
    with pytest.raises(HTTPException) as ei:
        await L.svc_exec_review(
            make_session(), tenant_id=uuid.uuid4(),
            actor={"sub": str(uuid.uuid4()), "role": "executive", "name": "E"},
            site_id=uuid.uuid4(), body=LaunchReviewRequest(verdict="rejected", comment="   "),
        )
    assert ei.value.status_code == 422


async def test_supervisor_review_requires_comment_on_reject(make_session):
    with pytest.raises(HTTPException) as ei:
        await L.svc_supervisor_review(
            make_session(), tenant_id=uuid.uuid4(),
            actor={"sub": str(uuid.uuid4()), "role": "supervisor", "name": "S"},
            site_id=uuid.uuid4(), body=LaunchReviewRequest(verdict="rejected"),
        )
    assert ei.value.status_code == 422


# ── FSM status / role guards ───────────────────────────────────────────────────────

async def test_send_for_review_wrong_status_422(make_session, fake_result):
    site = _site()
    appr = _appr(site, status="under_exec_review")  # not pending_admin_review
    sess = make_session(fake_result(scalar=site), fake_result(scalar=appr))
    with pytest.raises(HTTPException) as ei:
        await L.svc_admin_send_for_review(
            sess, tenant_id=site.tenant_id, actor=_admin(),
            site_id=site.id, body=LaunchCommentRequest(),
        )
    assert ei.value.status_code == 422


async def test_final_confirm_wrong_status_422(make_session, fake_result):
    site = _site()
    appr = _appr(site, status="under_exec_review")  # not pending_admin_final
    sess = make_session(fake_result(scalar=site), fake_result(scalar=appr))
    with pytest.raises(HTTPException) as ei:
        await L.svc_admin_final_confirm(
            sess, tenant_id=site.tenant_id, actor=_admin(),
            site_id=site.id, body=LaunchCommentRequest(),
        )
    assert ei.value.status_code == 422


async def test_exec_review_blocks_non_creator_403(make_session, fake_result):
    site = _site()  # submitted_by is a random user, not the actor below
    appr = _appr(site, status="under_exec_review")
    sess = make_session(fake_result(scalar=site), fake_result(scalar=appr))
    with pytest.raises(HTTPException) as ei:
        await L.svc_exec_review(
            sess, tenant_id=site.tenant_id,
            actor={"sub": str(uuid.uuid4()), "role": "executive", "name": "Not the creator"},
            site_id=site.id, body=LaunchReviewRequest(verdict="approved"),
        )
    assert ei.value.status_code == 403


async def test_launch_wrong_status_422(make_session, fake_result):
    site = _site()
    appr = _appr(site, status="pending_admin_final")  # not ready_to_launch
    sess = make_session(fake_result(scalar=site), fake_result(scalar=appr))
    with pytest.raises(HTTPException) as ei:
        await L.svc_launch(sess, tenant_id=site.tenant_id, actor=_admin(), site_id=site.id)
    assert ei.value.status_code == 422
