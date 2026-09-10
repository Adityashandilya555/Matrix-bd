"""Launch validation-loop service tests (migration 202606121 / launch_service).

Validates the parts the feature cares about WITHOUT a live DB (see conftest.py
philosophy): the rent-only edit diff, the final commit field mapping, and the
FSM / role guards. Each guard test only needs the queued results consumed before
the guard fires, so they stay robust.
"""
from __future__ import annotations

import json
import uuid
from datetime import date

import pytest
from fastapi import HTTPException

from app.db import models
from app.domain.schemas.launch import (
    COMMERCIAL_EDITABLE_FIELDS,
    EDITABLE_FIELDS,
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


def test_apply_staging_edits_emits_diff_only_for_changes():
    row = models.LaunchApproval(
        id=uuid.uuid4(), site_id=uuid.uuid4(), tenant_id=uuid.uuid4(),
        status="pending_admin_review", rent_type="fixed", expected_rent=100000.0, escalation_pct=5.0,
    )
    body = LaunchRentFieldsRequest(rent_type="fixed", expected_rent=120000, escalation_pct=5)
    changes = L._apply_staging_edits(row, body)

    # rent_type + escalation unchanged → only expected_rent is a diff.
    assert {c["field"] for c in changes} == {"expected_rent"}
    assert row.expected_rent == 120000
    ch = changes[0]
    assert ch["from"] == "100000" and ch["to"] == "120000"  # integral floats render clean
    assert ch["label"]  # human label present for the timeline


def test_apply_staging_edits_noop_returns_empty():
    row = models.LaunchApproval(
        id=uuid.uuid4(), site_id=uuid.uuid4(), tenant_id=uuid.uuid4(),
        status="pending_admin_review", rent_type="revshare", rev_share_pct=12.0,
    )
    assert L._apply_staging_edits(row, LaunchRentFieldsRequest(rev_share_pct=12)) == []


# ── the escalation schedule: structure in, structure out ──────────────────────────
#
# Two defects met on this field. _str() fell through to str(), which on a list of
# dicts is Python's repr — single-quoted — so the timeline rendered
# `[{'year': 1, 'percent': 12.0}]` verbatim and no frontend parser could recover
# it. And _norm() compared containers the same way, so Pydantic's int->float
# coercion logged a phantom "Edited rent" on a save that changed nothing.

def _sched_row(schedule):
    return models.LaunchApproval(
        id=uuid.uuid4(), site_id=uuid.uuid4(), tenant_id=uuid.uuid4(),
        status="pending_admin_review", rent_type="staggered", staggered_escalation=schedule,
    )


def test_schedule_diff_is_json_not_python_repr():
    """The frontend renders a table by parsing this; repr's quotes break that."""
    row = _sched_row([{"year": 1, "percent": 5}])
    changes = L._apply_staging_edits(
        row, LaunchRentFieldsRequest(staggered_escalation=[{"year": 1, "percent": 9}]),
    )
    to = changes[0]["to"]
    assert "'" not in to, f"Python repr leaked into the timeline: {to}"
    assert json.loads(to) == [{"year": 1, "percent": 9.0}]


def test_resaving_the_same_schedule_is_not_an_edit():
    """The phantom edit: jsonb stores percent as int 12, Pydantic hands back 12.0."""
    row = _sched_row([{"year": 1, "percent": 12, "dine_in_pct": 2, "delivery_pct": 3}])
    body = LaunchRentFieldsRequest(
        staggered_escalation=[{"year": 1, "percent": 12, "dine_in_pct": 2, "delivery_pct": 3}],
    )
    assert L._apply_staging_edits(row, body) == []


def test_key_order_alone_is_not_an_edit():
    """Postgres jsonb reorders object keys on storage; that is not a rent change."""
    row = _sched_row([{"percent": 5, "year": 1}])
    body = LaunchRentFieldsRequest(staggered_escalation=[{"year": 1, "percent": 5}])
    assert L._apply_staging_edits(row, body) == []


def test_a_real_schedule_change_is_still_detected():
    """The guard above must not swallow the edit in the reported screenshot —
    a three-year schedule dropping to two."""
    row = _sched_row([{"year": 1, "percent": 12}, {"year": 2, "percent": 4}, {"year": 3, "percent": 7}])
    body = LaunchRentFieldsRequest(
        staggered_escalation=[{"year": 1, "percent": 12}, {"year": 2, "percent": 4}],
    )
    changes = L._apply_staging_edits(row, body)
    assert [c["field"] for c in changes] == ["staggered_escalation"]
    assert len(json.loads(changes[0]["from"])) == 3
    assert len(json.loads(changes[0]["to"])) == 2


def test_scalar_stringification_is_unchanged():
    """Integral floats still lose the .0; real decimals keep it."""
    assert L._str(120000.0) == "120000"
    assert L._str(4.5) == "4.5"
    assert L._str(None) is None


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


async def test_exec_review_allows_supervisor_creator(make_session, fake_result):
    # The first review stage is role-agnostic: a SUPERVISOR who created the site
    # (supervisors can create via delegation) must be able to review it. Regression
    # for "after send-for-review it never reached the creator" (creator was a supervisor).
    creator_id = uuid.uuid4()
    site = _site(submitted_by=creator_id)
    appr = _appr(site, status="under_exec_review")
    sess = make_session(fake_result(scalar=site), fake_result(scalar=appr))
    resp = await L.svc_exec_review(
        sess, tenant_id=site.tenant_id,
        actor={"sub": str(creator_id), "role": "supervisor", "name": "Supervisor-creator"},
        site_id=site.id, body=LaunchReviewRequest(verdict="approved"),
    )
    assert resp.status == "under_supervisor_review"
    assert resp.exec_verdict == "approved"


async def test_launch_wrong_status_422(make_session, fake_result):
    site = _site()
    appr = _appr(site, status="pending_admin_final")  # not ready_to_launch
    sess = make_session(fake_result(scalar=site), fake_result(scalar=appr))
    with pytest.raises(HTTPException) as ei:
        await L.svc_launch(sess, tenant_id=site.tenant_id, actor=_admin(), site_id=site.id)
    assert ei.value.status_code == 422


# ── #229: the review's NSO-license block reflects canonical Legal Licensing ───

async def test_build_response_licenses_come_from_legal_not_nso(make_session, fake_result):
    # The business-admin review showed every license PENDING because it read the
    # never-synced nso_reviews.*_status columns. It must derive from the legal
    # site_licensing row instead. Here nso_reviews says all "pending" but legal
    # licensing has FSSAI granted -> the response must show fssai done.
    site = _site(licensing_status="complete")
    appr = _appr(site, status="ready_to_launch")
    nso = models.NsoReview(
        site_id=site.id, tenant_id=site.tenant_id,
        fssai_status="pending", health_trade_status="pending",
        shops_estab_status="pending", fire_noc_status="pending",
        storage_license_status="pending",
    )
    licensing = models.SiteLicensing(
        site_id=site.id,
        fssai="yes", health_trade="pending", shops_estab_reg="pending",
        fire_noc="pending", storage_license="pending",
    )
    sess = make_session(
        fake_result(scalar=None),       # SiteDetail
        fake_result(scalar=nso),        # NsoReview (all *_status = "pending")
        fake_result(scalars_list=[]),   # LaunchReviewEvent
        fake_result(scalar=licensing),  # SiteLicensing (fssai = "yes")
    )
    resp = await L._build_response(sess, row=appr, site=site)
    dep = resp.departments
    assert dep.fssai_status == "done"            # from legal "yes", NOT nso "pending"
    assert dep.health_trade_status == "pending"
    assert dep.storage_license_status == "pending"


# ── commercial terms: the editable set ─────────────────────────────────────────

def test_commercial_editable_set_holds_the_six_renegotiable_fields():
    assert set(COMMERCIAL_EDITABLE_FIELDS) == {
        "carpet_area_sqft", "cam_charges", "capex",
        "security_deposit", "brokerage", "rent_start_date",
    }


def test_editable_fields_is_the_disjoint_union():
    # The two tuples must not overlap, or a field would be diffed twice and the
    # per-field permission lookup would depend on iteration order.
    assert set(RENT_EDITABLE_FIELDS).isdisjoint(COMMERCIAL_EDITABLE_FIELDS)
    assert set(EDITABLE_FIELDS) == set(RENT_EDITABLE_FIELDS) | set(COMMERCIAL_EDITABLE_FIELDS)


def test_apply_staging_edits_diffs_commercial_fields():
    row = models.LaunchApproval(
        id=uuid.uuid4(), site_id=uuid.uuid4(), tenant_id=uuid.uuid4(),
        status="pending_admin_review", carpet_area_sqft=1200.0, cam_charges=0.0,
    )
    changes = L._apply_staging_edits(
        row, LaunchRentFieldsRequest(carpet_area_sqft=1400, cam_charges=0),
    )
    # cam_charges is unchanged (0 == 0), so only the carpet area is a diff.
    assert {c["field"] for c in changes} == {"carpet_area_sqft"}
    assert changes[0]["label"] == "Carpet area (sqft)"
    assert row.carpet_area_sqft == 1400


# ── commercial terms: who may edit what, when ─────────────────────────────────

def _actor(role, sub=None):
    return {"sub": str(sub or uuid.uuid4()), "role": role, "name": role.title()}


def test_admin_may_edit_commercial_at_both_admin_touches():
    site = _site()
    for status in ("pending_admin_review", "pending_admin_final"):
        row = _appr(site, status=status)
        # Does not raise.
        L._assert_may_edit(site, row, _admin(), {"carpet_area_sqft", "brokerage"})


def test_supervisor_may_edit_commercial_at_supervisor_review():
    site = _site()
    row = _appr(site, status="under_supervisor_review")
    L._assert_may_edit(site, row, _actor("supervisor"), set(COMMERCIAL_EDITABLE_FIELDS))


def test_executive_may_set_rent_start_date_at_their_own_stage():
    creator = uuid.uuid4()
    site = _site(submitted_by=creator)
    row = _appr(site, status="under_exec_review")
    L._assert_may_edit(site, row, _actor("executive", creator), {"rent_start_date"})


def test_executive_may_not_edit_the_other_commercial_fields():
    creator = uuid.uuid4()
    site = _site(submitted_by=creator)
    row = _appr(site, status="under_exec_review")
    with pytest.raises(HTTPException) as e:
        L._assert_may_edit(site, row, _actor("executive", creator), {"carpet_area_sqft"})
    assert e.value.status_code == 422
    # The message must name the field — a blanket "not editable" sends the
    # reviewer hunting for which of six inputs was rejected.
    assert "carpet_area_sqft" in e.value.detail


def test_executive_may_not_edit_rent_at_their_own_stage():
    creator = uuid.uuid4()
    site = _site(submitted_by=creator)
    row = _appr(site, status="under_exec_review")
    with pytest.raises(HTTPException) as e:
        L._assert_may_edit(site, row, _actor("executive", creator), {"expected_rent"})
    assert e.value.status_code == 422


def test_a_non_creator_executive_cannot_set_the_rent_start_date():
    site = _site(submitted_by=uuid.uuid4(), assigned_to=None)
    row = _appr(site, status="under_exec_review")
    with pytest.raises(HTTPException) as e:
        L._assert_may_edit(site, row, _actor("executive"), {"rent_start_date"})
    assert e.value.status_code == 403


def test_admin_cannot_edit_while_the_record_is_out_for_review():
    site = _site()
    row = _appr(site, status="under_supervisor_review")
    with pytest.raises(HTTPException) as e:
        L._assert_may_edit(site, row, _admin(), {"brokerage"})
    assert e.value.status_code == 422


# ── commercial terms: commit + the final-confirm guard ────────────────────────

def test_commit_writes_the_commercial_columns_to_site_details():
    site = _site()
    detail = models.SiteDetail(id=uuid.uuid4(), site_id=site.id, tenant_id=site.tenant_id)
    row = _appr(
        site, rent_type="fixed", expected_rent=200000.0,
        carpet_area_sqft=1400.0, cam_charges=5000.0, capex=250000.0,
        security_deposit=1350000.0, brokerage=120950.0,
        rent_start_date=date(2026, 5, 1),
    )
    L._commit_rent_to_canonical(site, detail, row)
    assert detail.carpet_area_sqft == 1400.0
    assert detail.cam_charges == 5000.0
    assert detail.capex == 250000.0
    assert detail.security_deposit == 1350000.0
    assert detail.brokerage == 120950.0
    assert detail.rent_start_date == date(2026, 5, 1)


def test_commit_does_not_touch_sites_area_sqft():
    # sites.area_sqft is the pipeline-stage gross area, a different measurement
    # from the LOI carpet area. Merging the two would silently rewrite it.
    site = _site(area_sqft=999.0)
    detail = models.SiteDetail(id=uuid.uuid4(), site_id=site.id, tenant_id=site.tenant_id)
    row = _appr(site, rent_type="fixed", carpet_area_sqft=1400.0)
    L._commit_rent_to_canonical(site, detail, row)
    assert site.area_sqft == 999.0


async def test_final_confirm_requires_a_rent_start_date(make_session, fake_result):
    # The confirm is what makes the staged terms canonical, so it is the last
    # chance to catch a missing rent commencement date. Status is correct here —
    # only the blank date stops it.
    site = _site()
    appr = _appr(site, status="pending_admin_final", rent_start_date=None)
    sess = make_session(fake_result(scalar=site), fake_result(scalar=appr))
    with pytest.raises(HTTPException) as ei:
        await L.svc_admin_final_confirm(
            sess, tenant_id=site.tenant_id, actor=_admin(),
            site_id=site.id, body=LaunchCommentRequest(),
        )
    assert ei.value.status_code == 422
    assert "rent start date" in ei.value.detail.lower()
    # It must not have committed anything on the way to raising.
    assert appr.status == "pending_admin_final"
    assert appr.committed_at is None


# ── the Add Details → launch loop column chain ────────────────────────────────
#
# The launch loop must edit the SAME columns the LOI "Add Details" form writes,
# or a reviewer would renegotiate a number nobody reads back. Two of the four
# names in that chain are non-obvious and easy to mis-wire:
#
#   form key "carpet" -> site_details.carpet_area_sqft   (NOT sites.area_sqft)
#   form key "cadex"  -> site_details.capex              (the key is a typo)
#
# sites.area_sqft is the New Pipeline gross area. It only PRE-FILLS the blank
# carpet field in Add Details (AddDetailsPage L136-141); once saved, carpet lives
# in carpet_area_sqft and the two are independent.

def test_add_details_form_keys_map_to_the_columns_the_loop_edits():
    from app.services.bd_service import _SITE_DETAIL_KEY_MAP
    assert _SITE_DETAIL_KEY_MAP["carpet"] == "carpet_area_sqft"
    assert _SITE_DETAIL_KEY_MAP["cadex"] == "capex"
    assert _SITE_DETAIL_KEY_MAP["cam"] == "cam_charges"
    assert _SITE_DETAIL_KEY_MAP["deposit"] == "security_deposit"
    assert _SITE_DETAIL_KEY_MAP["brokerage"] == "brokerage"
    # Every column Add Details writes for these five is one the loop can edit.
    for form_key in ("carpet", "cam", "cadex", "deposit", "brokerage"):
        assert _SITE_DETAIL_KEY_MAP[form_key] in COMMERCIAL_EDITABLE_FIELDS


def test_the_loop_does_not_edit_the_pipeline_area():
    # sites.area_sqft is a different measurement, captured in New Pipeline and
    # audited as a pipeline field. Adding it here would let a launch reviewer
    # silently rewrite the gross area while editing the carpet area.
    from app.services.audit_service import PIPELINE_FIELDS
    assert "area_sqft" in PIPELINE_FIELDS
    assert "area_sqft" not in COMMERCIAL_EDITABLE_FIELDS
    assert "area_sqft" not in EDITABLE_FIELDS


def test_site_response_reads_carpet_and_capex_from_the_committed_columns():
    # The round trip: what the loop commits is what Add Details and the site
    # drawer read back (item.carpet / item.cadex).
    from app.services._common import site_to_response
    site = _site()
    detail = models.SiteDetail(
        id=uuid.uuid4(), site_id=site.id, tenant_id=site.tenant_id,
        carpet_area_sqft=1400.0, capex=250000.0,
    )
    resp = site_to_response(site, details=detail)
    assert resp.carpet == 1400.0
    assert resp.cadex == 250000.0


def test_staging_row_is_seeded_from_the_same_detail_columns():
    # svc_create_launch_approval copies site_details -> launch_approvals at NSO
    # final approval. If it read the wrong column the loop would open showing a
    # different number from the one Add Details captured.
    import inspect
    src = inspect.getsource(L.svc_create_launch_approval)
    assert "row.carpet_area_sqft = _num(detail.carpet_area_sqft)" in src
    assert "row.capex = _num(detail.capex)" in src
    assert "row.cam_charges = _num(detail.cam_charges)" in src
    assert "row.security_deposit = _num(detail.security_deposit)" in src
    assert "row.brokerage = _num(detail.brokerage)" in src


# ── the full-snapshot PATCH the surfaces actually send ────────────────────────
#
# Both launch surfaces hydrate EVERY editable field off the record and PATCH the
# whole snapshot back, so a request carries all 17 fields even when one changed.
# The earlier gate ran on what the body CONTAINED, which meant the executive was
# rejected on the first unchanged field they may not touch and could never save
# the rent start date at all. Gating on the DIFF is what makes the matrix work.
#
# These tests build the real payload shape. Asserting against a hand-picked field
# set (as the _assert_may_edit tests above do) is what let the bug through.

_STORED = dict(
    rent_type="fixed", expected_rent=205000.0, rev_share_pct=None,
    revshare_dinein_pct=None, revshare_delivery_pct=None,
    escalation_pct=15.0, expected_escalation_years=3,
    staggered_escalation=None, rent_free_days=None,
    lock_in_months=None, tenure_months=None,
    carpet_area_sqft=1200.0, cam_charges=0.0, capex=0.0,
    security_deposit=1350000.0, brokerage=120950.0, rent_start_date=None,
)


def _snapshot_save(role, status, changed, is_creator=True):
    """Run the gate exactly as svc_save_rent_fields does, for a full snapshot."""
    creator = uuid.uuid4()
    site = _site(submitted_by=creator, assigned_to=None)
    row = _appr(site, status=status, **_STORED)
    body = LaunchRentFieldsRequest(**{**_STORED, **changed})
    actor = {"sub": str(creator if is_creator else uuid.uuid4()), "role": role, "name": role}
    changes, _values = L._compute_staging_changes(row, body)
    if changes:
        L._assert_may_edit(site, row, actor, {c["field"] for c in changes})
    return [c["field"] for c in changes]


def test_executive_can_save_the_date_in_a_full_snapshot_patch():
    # The regression: this raised 422 on 'brokerage' before ever reaching the
    # one field the executive is allowed to change.
    assert _snapshot_save(
        "executive", "under_exec_review", {"rent_start_date": date(2026, 5, 1)},
    ) == ["rent_start_date"]


def test_supervisor_and_admin_also_save_via_full_snapshots():
    for role, status in (("supervisor", "under_supervisor_review"),
                         ("business_admin", "pending_admin_final"),
                         ("business_admin", "pending_admin_review")):
        assert _snapshot_save(role, status, {"rent_start_date": date(2026, 5, 1)}) == ["rent_start_date"]


def test_an_unchanged_snapshot_is_a_no_op_for_every_role():
    # Nothing changed => nothing to authorise. A role with no edit rights at this
    # status must not be 422'd merely for echoing the record back.
    for role, status in (("executive", "under_exec_review"),
                         ("business_admin", "under_supervisor_review"),
                         ("supervisor", "pending_admin_final")):
        assert _snapshot_save(role, status, {}) == []


def test_the_snapshot_path_still_blocks_a_disallowed_change():
    # Gating on the diff must not become "anything goes".
    for field, value in (("brokerage", 999.0), ("expected_rent", 1.0), ("capex", 5.0)):
        with pytest.raises(HTTPException) as e:
            _snapshot_save("executive", "under_exec_review", {field: value})
        assert e.value.status_code == 422
        assert field in e.value.detail


def test_the_snapshot_path_still_blocks_a_non_creator_executive():
    with pytest.raises(HTTPException) as e:
        _snapshot_save(
            "executive", "under_exec_review",
            {"rent_start_date": date(2026, 5, 1)}, is_creator=False,
        )
    assert e.value.status_code == 403


def test_compute_staging_changes_does_not_mutate_the_row():
    # The gate runs between compute and apply, so computing must leave the row
    # untouched — otherwise a rejected edit would already have been written.
    site = _site()
    row = _appr(site, status="under_exec_review", **_STORED)
    body = LaunchRentFieldsRequest(**{**_STORED, "brokerage": 999.0})
    changes, values = L._compute_staging_changes(row, body)
    assert [c["field"] for c in changes] == ["brokerage"]
    assert values == {"brokerage": 999.0}
    assert row.brokerage == 120950.0        # unchanged
