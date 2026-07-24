"""Undo for whitelisted, side-effect-free approval decisions.

Three gates share one machinery: the generic scaffolding (table, guards,
dispatcher) lives in reversible_service; each owning service supplies the
capture at action time and the compensating restore. The audit log cannot drive
an inverse — the design module records no before-state on any audit row — so the
prior values are snapshotted at action time, the shape that makes archive/revive
work.

The guards ARE the feature: an undo that fires when it shouldn't is far worse
than one that refuses. The GFC hard-stop in particular keeps an admin approval
from being unwound after it has opened a Project Excellence budget that nothing
in this codebase can delete.
"""
from __future__ import annotations

import datetime as _dt
import inspect

import pytest
from fastapi import HTTPException

from app.db import models
from app.services import bd_service, design_service as ds, reversible_service as rs

TENANT = "22222222-2222-2222-2222-222222222222"
SITE_ID = "11111111-1111-1111-1111-111111111111"
DELIV_ID = "44444444-4444-4444-4444-444444444444"
REV_ID = "55555555-5555-5555-5555-555555555555"
ADMIN = {"sub": "33333333-3333-3333-3333-333333333333", "name": "Ada Admin",
         "role": "business_admin", "real_role": "business_admin"}
OTHER = {"sub": "99999999-9999-9999-9999-999999999999", "name": "Otto",
         "role": "business_admin", "real_role": "business_admin"}
NOT_ADMIN = {"sub": ADMIN["sub"], "name": "Sam", "role": "supervisor", "real_role": "supervisor"}


def _site(status="loi_uploaded", design_status="in_progress"):
    s = models.Site(tenant_id=TENANT, name="Test Site", code="TS-001")
    s.id = SITE_ID
    s.status = status
    s.design_status = design_status
    s.approved_at = None
    s.assigned_to = None
    s.submitted_by = None
    return s


def _review(current_stage="gfc", approved_by=None):
    r = models.DesignReview(tenant_id=TENANT, site_id=SITE_ID)
    r.current_stage = current_stage
    r.approved_by = approved_by
    r.gfc_status = "pending"
    return r


def _deliverable(status="approved", admin_status="approved", reviewed_by=None):
    d = models.DesignDeliverable(tenant_id=TENANT, site_id=SITE_ID, kind="3d")
    d.id = DELIV_ID
    d.status = status
    d.admin_status = admin_status
    d.admin_reviewed_by = ADMIN["sub"]
    d.admin_reviewed_at = _dt.datetime(2026, 7, 21, 12, 0, tzinfo=_dt.timezone.utc)
    d.admin_comments = None
    d.reviewed_by = reviewed_by
    d.reviewed_at = None
    d.supervisor_comments = None
    return d


def _reversible(*, action, snapshot, actor_id=None, consumed_at=None, entity_type="design_deliverable"):
    r = models.ReversibleAction(
        tenant_id=TENANT, site_id=SITE_ID, action=action,
        entity_type=entity_type, entity_id=DELIV_ID if entity_type == "design_deliverable" else SITE_ID,
        actor_id=actor_id or ADMIN["sub"], snapshot=snapshot,
    )
    r.id = REV_ID
    r.consumed_at = consumed_at
    r.consumed_by = None
    return r


# Well-formed admin-approve snapshot: 3D was awaiting admin, now approved.
_ADMIN_SNAP = {
    "snapshot_version": rs.SNAPSHOT_VERSION, "kind": "3d", "decision": "approve",
    "before": {
        "deliverable": {"status": "approved", "admin_status": "pending",
                        "admin_reviewed_by": None, "admin_reviewed_at": None, "admin_comments": None},
        "review": {"current_stage": "3d", "approved_by": None},
        "site": {"design_status": "in_progress"},
    },
    "after": {
        "deliverable": {"status": "approved", "admin_status": "approved",
                        "admin_reviewed_by": ADMIN["sub"],
                        "admin_reviewed_at": "2026-07-21T12:00:00+00:00", "admin_comments": None},
        "review": {"current_stage": "gfc", "approved_by": None},
        "site": {"design_status": "in_progress"},
    },
}
_SUP_SNAP = {
    "snapshot_version": rs.SNAPSHOT_VERSION, "kind": "3d", "decision": "approve",
    "before": {
        "deliverable": {"status": "submitted", "admin_status": "pending",
                        "reviewed_by": None, "reviewed_at": None, "supervisor_comments": None},
        "review": {"current_stage": "3d", "approved_by": None},
        "site": {"design_status": "in_progress"},
    },
    "after": {
        "deliverable": {"status": "approved", "admin_status": "pending",
                        "reviewed_by": ADMIN["sub"], "reviewed_at": "2026-07-21T12:00:00+00:00",
                        "supervisor_comments": None},
        "review": {"current_stage": "3d", "approved_by": ADMIN["sub"]},
        "site": {"design_status": "in_progress"},
    },
}
_BD_SNAP = {
    "snapshot_version": rs.SNAPSHOT_VERSION,
    "before": {"site": {"status": "details_submitted", "approved_at": None}},
    "after": {"site": {"status": "approved", "approved_at": "2026-07-21T12:00:00+00:00"}},
}


@pytest.fixture
def stubs(monkeypatch):
    events, audits = [], []

    async def _notify(_s, **kw):
        events.append(kw)

    async def _audit(_s, **kw):
        audits.append(kw)
        return models.AuditLog(tenant_id=TENANT, action=kw.get("action", ""))

    async def _recips(_s, **_kw):
        return ["someone"]

    async def _no_budget(_s, **_kw):
        return None

    for mod in (ds, bd_service):
        monkeypatch.setattr(mod, "notify_enqueue", _notify)
        monkeypatch.setattr(mod, "write_audit_event", _audit)
    monkeypatch.setattr(ds, "recipients_for_design_supervisors", _recips)
    monkeypatch.setattr(bd_service, "recipients_for_site_owner", _recips)
    monkeypatch.setattr(ds.budget_service, "fetch_budget", _no_budget)
    return {"events": events, "audits": audits}


# ── Structural guarantees ─────────────────────────────────────────────────────

def test_dispatcher_owns_the_common_guards_and_lock():
    src = inspect.getsource(rs.svc_undo_reversible_action)
    assert "fetch_site_for_update_or_404" in src   # site locked first
    assert "async with transaction(" in src
    assert "actor_is_business_admin" in src
    assert "snapshot_version" in src               # version guard
    assert "consumed_at is not None" in src


def test_dispatcher_params_are_keyword_only():
    params = list(inspect.signature(rs.svc_undo_reversible_action).parameters.values())
    assert params[0].name == "session"
    assert all(p.kind is inspect.Parameter.KEYWORD_ONLY for p in params[1:])


def test_undo_never_deletes_an_audit_row():
    """Append-only ledger: undo adds a row, never erases one."""
    for fn in (rs.svc_undo_reversible_action, ds._undo_admin_review,
               ds._undo_supervisor_review, bd_service.apply_reversible_undo):
        src = inspect.getsource(fn)
        assert "session.delete" not in src and "delete(" not in src


def test_only_the_admin_review_path_has_the_gfc_hard_stop():
    """The budget stop is specific to the admin gate — the supervisor and BD
    gates never open a budget, so importing it there would be a false block."""
    assert "budget_service.fetch_budget" in inspect.getsource(ds._undo_admin_review)
    assert "fetch_budget" not in inspect.getsource(ds._undo_supervisor_review)
    assert "fetch_budget" not in inspect.getsource(bd_service.apply_reversible_undo)


def test_each_gate_records_a_snapshot():
    """Every whitelisted gate persists a snapshot in the same transaction as the
    mutation. The supervisor gate routes through a helper (extracted to keep
    svc_review_deliverable under the C901 gate), so follow that one call deep."""
    assert "reversible_service.record_reversible" in inspect.getsource(ds.svc_admin_review_deliverable)
    assert "_record_supervisor_review_snapshot" in inspect.getsource(ds.svc_review_deliverable)
    assert "reversible_service.record_reversible" in inspect.getsource(ds._record_supervisor_review_snapshot)
    assert "reversible_service.record_reversible" in inspect.getsource(bd_service.svc_approve_shortlist)


def test_dispatcher_does_not_import_the_owning_services():
    """The registry exists so the dependency arrow points one way only. A lazy
    import inside the dispatcher would work at runtime but is still a cycle to a
    static analyser — which is exactly what DeepSource flagged (PYL-R0401)."""
    import ast
    src = inspect.getsource(rs)
    tree = ast.parse(src)
    imported = {
        alias.name for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module
        for alias in node.names
    } | {
        node.module for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module
    }
    assert not any("design_service" in m or "bd_service" in m for m in imported)
    # ...and every action really is registered by its owner.
    assert set(rs._HANDLERS) == {
        rs.ACTION_DESIGN_ADMIN_REVIEW,
        rs.ACTION_DESIGN_SUPERVISOR_REVIEW,
        rs.ACTION_BD_SITE_APPROVAL,
    }


def test_router_exposes_undo_under_business_admin_on_sites():
    import app.routers.sites as r
    src = inspect.getsource(r)
    assert '"/{site_id}/reversible-actions/{reversible_id}/undo"' in src
    assert "BusinessAdmin" in inspect.getsource(r.undo_reversible_action)


# ── Common guards (via the real dispatcher) ───────────────────────────────────

async def test_non_admin_is_refused(make_session, stubs):
    with pytest.raises(HTTPException) as e:
        await rs.svc_undo_reversible_action(
            make_session(), tenant_id=TENANT, actor=NOT_ADMIN, site_id=SITE_ID, reversible_id=REV_ID)
    assert e.value.status_code == 403


async def test_another_admins_decision_is_refused(make_session, fake_result, stubs):
    sess = make_session(
        fake_result(scalar=_site()),
        fake_result(scalar=_reversible(action=rs.ACTION_DESIGN_ADMIN_REVIEW, snapshot=_ADMIN_SNAP, actor_id=OTHER["sub"])),
    )
    with pytest.raises(HTTPException) as e:
        await rs.svc_undo_reversible_action(sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID)
    assert e.value.status_code == 403


async def test_already_consumed_is_refused(make_session, fake_result, stubs):
    consumed = _reversible(action=rs.ACTION_DESIGN_ADMIN_REVIEW, snapshot=_ADMIN_SNAP,
                           consumed_at=_dt.datetime(2026, 7, 21, tzinfo=_dt.timezone.utc))
    sess = make_session(fake_result(scalar=_site()), fake_result(scalar=consumed))
    with pytest.raises(HTTPException) as e:
        await rs.svc_undo_reversible_action(sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID)
    assert e.value.status_code == 409


async def test_unknown_snapshot_version_is_refused(make_session, fake_result, stubs):
    snap = {**_ADMIN_SNAP, "snapshot_version": 999}
    sess = make_session(fake_result(scalar=_site()),
                        fake_result(scalar=_reversible(action=rs.ACTION_DESIGN_ADMIN_REVIEW, snapshot=snap)))
    with pytest.raises(HTTPException) as e:
        await rs.svc_undo_reversible_action(sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID)
    assert e.value.status_code == 409
    assert "older version" in e.value.detail


async def test_forged_id_is_a_404_not_a_leak(make_session, fake_result, stubs):
    sess = make_session(fake_result(scalar=_site()), fake_result(scalar=None))  # row not found
    with pytest.raises(HTTPException) as e:
        await rs.svc_undo_reversible_action(sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID)
    assert e.value.status_code == 404


# ── Admin-review undo ─────────────────────────────────────────────────────────

async def test_admin_undo_restores_before_and_consumes(make_session, fake_result, stubs):
    site, review, deliv = _site(), _review(), _deliverable()
    rev = _reversible(action=rs.ACTION_DESIGN_ADMIN_REVIEW, snapshot=_ADMIN_SNAP)
    # fetch_budget is stubbed (no session read), so the queue is site, rev,
    # review, deliv — no budget slot.
    sess = make_session(
        fake_result(scalar=site), fake_result(scalar=rev),
        fake_result(scalar=review), fake_result(scalar=deliv),
    )
    await rs.svc_undo_reversible_action(sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID)

    assert deliv.admin_status == "pending"          # restored
    assert review.current_stage == "3d"
    assert rev.consumed_at is not None and str(rev.consumed_by) == ADMIN["sub"]
    assert "design_admin_review_undone" in [a["action"] for a in stubs["audits"]]


async def test_admin_undo_blocked_once_gfc_budget_exists(make_session, fake_result, monkeypatch, stubs):
    async def _has_budget(_s, **_kw):
        return object()
    monkeypatch.setattr(ds.budget_service, "fetch_budget", _has_budget)

    rev = _reversible(action=rs.ACTION_DESIGN_ADMIN_REVIEW, snapshot=_ADMIN_SNAP)
    sess = make_session(fake_result(scalar=_site()), fake_result(scalar=rev), fake_result(scalar=object()))
    with pytest.raises(HTTPException) as e:
        await rs.svc_undo_reversible_action(sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID)
    assert e.value.status_code == 409
    assert "budget" in e.value.detail.lower()


async def test_admin_undo_refused_when_site_moved_on(make_session, fake_result, stubs):
    # Live admin_status differs from the snapshot's `after` — a later decision.
    moved = _deliverable(admin_status="rejected")
    rev = _reversible(action=rs.ACTION_DESIGN_ADMIN_REVIEW, snapshot=_ADMIN_SNAP)
    sess = make_session(
        fake_result(scalar=_site()), fake_result(scalar=rev),
        fake_result(scalar=_review()), fake_result(scalar=moved),
    )
    with pytest.raises(HTTPException) as e:
        await rs.svc_undo_reversible_action(sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID)
    assert e.value.status_code == 409
    assert "moved on" in e.value.detail


# ── Supervisor-review undo ────────────────────────────────────────────────────

async def test_supervisor_undo_restores_submitted(make_session, fake_result, stubs):
    review = _review(current_stage="3d", approved_by=ADMIN["sub"])
    deliv = _deliverable(status="approved", admin_status="pending", reviewed_by=ADMIN["sub"])
    deliv.reviewed_at = _dt.datetime(2026, 7, 21, 12, 0, tzinfo=_dt.timezone.utc)  # matches after-snapshot
    rev = _reversible(action=rs.ACTION_DESIGN_SUPERVISOR_REVIEW, snapshot=_SUP_SNAP)
    sess = make_session(
        fake_result(scalar=_site()), fake_result(scalar=rev),
        fake_result(scalar=review), fake_result(scalar=deliv),   # no budget query on this path
    )
    await rs.svc_undo_reversible_action(sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID)

    assert deliv.status == "submitted"           # back to awaiting supervisor
    assert deliv.reviewed_by is None
    assert review.approved_by is None
    assert "design_supervisor_review_undone" in [a["action"] for a in stubs["audits"]]


async def test_supervisor_undo_blocked_if_admin_then_reviewed(make_session, fake_result, stubs):
    # admin_status moved to 'approved' after the supervisor approval → frontier fails.
    review = _review(current_stage="3d", approved_by=ADMIN["sub"])
    deliv = _deliverable(status="approved", admin_status="approved", reviewed_by=ADMIN["sub"])
    deliv.reviewed_at = _dt.datetime(2026, 7, 21, 12, 0, tzinfo=_dt.timezone.utc)
    rev = _reversible(action=rs.ACTION_DESIGN_SUPERVISOR_REVIEW, snapshot=_SUP_SNAP)
    sess = make_session(
        fake_result(scalar=_site()), fake_result(scalar=rev),
        fake_result(scalar=review), fake_result(scalar=deliv),
    )
    with pytest.raises(HTTPException) as e:
        await rs.svc_undo_reversible_action(sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID)
    assert e.value.status_code == 409


# ── BD site-approval undo ─────────────────────────────────────────────────────

async def test_bd_approval_undo_reverts_to_details_submitted(make_session, fake_result, stubs):
    site = _site(status="approved")
    site.approved_at = _dt.datetime(2026, 7, 21, 12, 0, tzinfo=_dt.timezone.utc)
    rev = _reversible(action=rs.ACTION_BD_SITE_APPROVAL, snapshot=_BD_SNAP, entity_type="site")
    sess = make_session(fake_result(scalar=site), fake_result(scalar=rev))  # no further queries
    await rs.svc_undo_reversible_action(sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID)

    assert site.status == "details_submitted"
    assert site.approved_at is None
    assert "bd_site_approval_undone" in [a["action"] for a in stubs["audits"]]


async def test_bd_approval_undo_refused_after_loi_upload(make_session, fake_result, stubs):
    # Live status is loi_uploaded, snapshot after says 'approved' → frontier fails.
    site = _site(status="loi_uploaded")
    site.approved_at = _dt.datetime(2026, 7, 21, 12, 0, tzinfo=_dt.timezone.utc)
    rev = _reversible(action=rs.ACTION_BD_SITE_APPROVAL, snapshot=_BD_SNAP, entity_type="site")
    sess = make_session(fake_result(scalar=site), fake_result(scalar=rev))
    with pytest.raises(HTTPException) as e:
        await rs.svc_undo_reversible_action(sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID)
    assert e.value.status_code == 409
    assert "moved on" in e.value.detail
