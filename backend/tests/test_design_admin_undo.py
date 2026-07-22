"""Undo for a business-admin 2D/3D deliverable decision.

The audit log cannot drive an inverse here: of the 89 write_audit_event call
sites only ~20% record a status before-value, and the design module records
none at all. So the prior values are snapshotted into `reversible_actions` at
action time — the same shape that makes archive/revive work.

These tests pin the guards, because the guards are the feature. An undo that
fires when it should not is far worse than one that refuses: it can strand a
Project Excellence budget that nothing in this codebase is able to delete.

Each numbered test maps to a row of the failure table in the plan.
"""
from __future__ import annotations

import datetime as _dt
import inspect

import pytest
from fastapi import HTTPException

from app.db import models
from app.services import design_service as ds

TENANT = "22222222-2222-2222-2222-222222222222"
SITE_ID = "11111111-1111-1111-1111-111111111111"
DELIV_ID = "44444444-4444-4444-4444-444444444444"
REV_ID = "55555555-5555-5555-5555-555555555555"
ADMIN = {"sub": "33333333-3333-3333-3333-333333333333", "name": "Ada Admin",
         "role": "business_admin", "real_role": "business_admin"}
OTHER_ADMIN = {"sub": "99999999-9999-9999-9999-999999999999", "name": "Otto",
               "role": "business_admin", "real_role": "business_admin"}


def _site(design_status="in_progress"):
    s = models.Site(tenant_id=TENANT, name="Test Site", code="TS-001")
    s.id = SITE_ID
    s.design_status = design_status
    return s


def _review(current_stage="gfc", approved_by=None):
    r = models.DesignReview(tenant_id=TENANT, site_id=SITE_ID)
    r.current_stage = current_stage
    r.approved_by = approved_by
    r.gfc_status = "pending"
    return r


def _deliverable(kind="3d", status="approved", admin_status="approved"):
    d = models.DesignDeliverable(tenant_id=TENANT, site_id=SITE_ID, kind=kind)
    d.id = DELIV_ID
    d.status = status
    d.admin_status = admin_status
    d.admin_reviewed_by = ADMIN["sub"]
    d.admin_reviewed_at = _dt.datetime(2026, 7, 21, 12, 0, tzinfo=_dt.timezone.utc)
    d.admin_comments = None
    return d


def _snapshot(*, before=None, after=None, version=ds.UNDO_SNAPSHOT_VERSION):
    """A well-formed approve snapshot: 3D was pending admin, now approved and
    the stage has advanced to 'gfc'."""
    return {
        "snapshot_version": version,
        "kind": "3d",
        "decision": "approve",
        "before": before or {
            "deliverable": {"status": "approved", "admin_status": "pending",
                            "admin_reviewed_by": None, "admin_reviewed_at": None,
                            "admin_comments": None},
            "review": {"current_stage": "3d", "approved_by": None},
            "site": {"design_status": "in_progress"},
        },
        "after": after or {
            "deliverable": {"status": "approved", "admin_status": "approved",
                            "admin_reviewed_by": ADMIN["sub"],
                            "admin_reviewed_at": "2026-07-21T12:00:00+00:00",
                            "admin_comments": None},
            "review": {"current_stage": "gfc", "approved_by": None},
            "site": {"design_status": "in_progress"},
        },
    }


def _reversible(*, actor_id=None, consumed_at=None, action=None, snapshot=None):
    r = models.ReversibleAction(
        tenant_id=TENANT, site_id=SITE_ID,
        action=action or ds.UNDO_ACTION_ADMIN_REVIEW,
        entity_type=ds.UNDO_ENTITY_DELIVERABLE, entity_id=DELIV_ID,
        actor_id=actor_id or ADMIN["sub"],
        snapshot=snapshot if snapshot is not None else _snapshot(),
    )
    r.id = REV_ID
    r.consumed_at = consumed_at
    r.consumed_by = None
    return r


@pytest.fixture
def stubs(monkeypatch):
    """Neutralise the IO around the mutation; record what was asked for."""
    events, audits = [], []

    async def _notify(_s, **kw):
        events.append(kw)

    async def _audit(_s, **kw):
        audits.append(kw)
        return models.AuditLog(tenant_id=TENANT, action=kw.get("action", ""))

    async def _sups(_s, **_kw):
        return ["sup-1"]

    async def _resp(_s, site):
        return site

    monkeypatch.setattr(ds, "notify_enqueue", _notify)
    monkeypatch.setattr(ds, "write_audit_event", _audit)
    monkeypatch.setattr(ds, "recipients_for_design_supervisors", _sups)
    monkeypatch.setattr(ds, "_build_design_response", _resp)
    return {"events": events, "audits": audits}


def _queue(make_session, fake_result, *, site, reversible, budget=None,
           review=None, deliverable=None):
    """Query order inside svc_undo_admin_review: site, reversible, budget,
    review, deliverable."""
    return make_session(
        fake_result(scalar=site),
        fake_result(scalar=reversible),
        fake_result(scalar=budget),
        fake_result(scalar=review),
        fake_result(scalar=deliverable),
    )


# ── Source invariants ─────────────────────────────────────────────────────────

def test_undo_locks_the_site_row_and_owns_its_transaction():
    src = inspect.getsource(ds.svc_undo_admin_review)
    assert "fetch_site_for_update_or_404" in src   # row lock, ordered site-first
    assert "async with transaction(" in src
    assert "write_audit_event" in src
    assert "budget_service.fetch_budget" in src    # the hard stop


def test_undo_params_are_keyword_only():
    params = list(inspect.signature(ds.svc_undo_admin_review).parameters.values())
    assert params[0].name == "session"
    assert all(p.kind is inspect.Parameter.KEYWORD_ONLY for p in params[1:])


def test_undo_never_deletes_the_original_audit_row():
    """The ledger is append-only: an undo adds a row, it does not erase one."""
    src = inspect.getsource(ds.svc_undo_admin_review)
    assert "session.delete" not in src
    assert "delete(" not in src


def test_admin_review_records_a_snapshot_on_both_decisions():
    src = inspect.getsource(ds.svc_admin_review_deliverable)
    assert "_capture_admin_review_state" in src
    assert "models.ReversibleAction(" in src
    # Captured before the mutations, else the "before" values are already gone.
    assert src.index("before = _capture_admin_review_state") < src.index("deliverable.admin_reviewed_by = ")


def test_router_exposes_undo_under_business_admin_guard():
    import app.routers.design as r
    src = inspect.getsource(r)
    assert '"/{site_id}/reversible-actions/{reversible_id}/undo"' in src
    assert "BusinessAdmin" in inspect.getsource(r.undo_admin_review)


# ── 0. Happy path ─────────────────────────────────────────────────────────────

async def test_undo_restores_every_snapshotted_field(make_session, fake_result, stubs):
    site, review, deliv = _site(), _review(), _deliverable()
    sess = _queue(make_session, fake_result, site=site, reversible=_reversible(),
                  review=review, deliverable=deliv)

    await ds.svc_undo_admin_review(
        sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID,
    )

    assert deliv.admin_status == "pending"
    assert deliv.admin_reviewed_by is None
    assert deliv.admin_reviewed_at is None
    assert review.current_stage == "3d"          # rolled back from 'gfc'
    assert site.design_status == "in_progress"
    actions = [a["action"] for a in stubs["audits"]]
    assert "design_admin_review_undone" in actions


async def test_undo_consumes_the_row_so_it_cannot_repeat(make_session, fake_result, stubs):
    row = _reversible()
    sess = _queue(make_session, fake_result, site=_site(), reversible=row,
                  review=_review(), deliverable=_deliverable())

    await ds.svc_undo_admin_review(
        sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID,
    )

    assert row.consumed_at is not None
    assert str(row.consumed_by) == ADMIN["sub"]


async def test_undo_notifies_supervisors_that_the_decision_was_reversed(
    make_session, fake_result, stubs,
):
    """The reject path already sent EMAIL that cannot be recalled, so the
    correction notice is the only way supervisors learn it no longer holds."""
    sess = _queue(make_session, fake_result, site=_site(), reversible=_reversible(),
                  review=_review(), deliverable=_deliverable())

    await ds.svc_undo_admin_review(
        sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID,
    )

    assert "design_admin_review_undone" in [e["event"] for e in stubs["events"]]


# ── 1. THE HARD STOP: a GFC budget exists ─────────────────────────────────────

async def test_undo_refused_once_the_gfc_budget_exists(make_session, fake_result, stubs):
    """Undoing here would orphan the budget + 11 items, and the PE admin queue
    filters on budget status ALONE — never on design_status — so an admin could
    still approve a budget whose design approval no longer exists."""
    budget = models.SiteBudget(tenant_id=TENANT, site_id=SITE_ID, phase="gfc")
    site, review, deliv = _site(), _review(), _deliverable()
    sess = _queue(make_session, fake_result, site=site, reversible=_reversible(),
                  budget=budget, review=review, deliverable=deliv)

    with pytest.raises(HTTPException) as exc:
        await ds.svc_undo_admin_review(
            sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID,
        )

    assert exc.value.status_code == 409
    assert "orphaned" in exc.value.detail
    assert deliv.admin_status == "approved"      # nothing was touched
    assert review.current_stage == "gfc"
    assert stubs["events"] == []


# ── 2/3. Downstream movement ──────────────────────────────────────────────────

@pytest.mark.parametrize(
    ("mutate", "why"),
    [
        (lambda s, r, d: setattr(r, "current_stage", "done"), "GFC already decided"),
        (lambda s, r, d: setattr(s, "design_status", "gfc_pending"), "supervisor sent for GFC"),
        (lambda s, r, d: setattr(d, "status", "submitted"), "3D re-submitted"),
        (lambda s, r, d: setattr(d, "admin_status", "pending"), "already re-opened"),
    ],
)
async def test_undo_refused_when_the_site_moved_on(
    make_session, fake_result, stubs, mutate, why,
):
    site, review, deliv = _site(), _review(), _deliverable()
    mutate(site, review, deliv)
    sess = _queue(make_session, fake_result, site=site, reversible=_reversible(),
                  review=review, deliverable=deliv)

    with pytest.raises(HTTPException) as exc:
        await ds.svc_undo_admin_review(
            sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID,
        )

    assert exc.value.status_code == 409, why
    assert "moved on" in exc.value.detail
    assert stubs["events"] == []


# ── 4. Original actor only ────────────────────────────────────────────────────

async def test_a_different_admin_cannot_undo(make_session, fake_result, stubs):
    sess = _queue(make_session, fake_result, site=_site(),
                  reversible=_reversible(actor_id=ADMIN["sub"]),
                  review=_review(), deliverable=_deliverable())

    with pytest.raises(HTTPException) as exc:
        await ds.svc_undo_admin_review(
            sess, tenant_id=TENANT, actor=OTHER_ADMIN, site_id=SITE_ID, reversible_id=REV_ID,
        )

    assert exc.value.status_code == 403
    assert "who made this decision" in exc.value.detail


async def test_non_admin_is_rejected_before_any_query(make_session, fake_result, stubs):
    sess = make_session()
    with pytest.raises(HTTPException) as exc:
        await ds.svc_undo_admin_review(
            sess, tenant_id=TENANT,
            actor={"sub": "x", "role": "supervisor", "real_role": "supervisor"},
            site_id=SITE_ID, reversible_id=REV_ID,
        )
    assert exc.value.status_code == 403
    assert sess.executed == []


# ── 5. Double-undo ────────────────────────────────────────────────────────────

async def test_second_undo_is_refused(make_session, fake_result, stubs):
    consumed = _reversible(consumed_at=_dt.datetime(2026, 7, 21, 13, 0, tzinfo=_dt.timezone.utc))
    sess = _queue(make_session, fake_result, site=_site(), reversible=consumed,
                  review=_review(), deliverable=_deliverable())

    with pytest.raises(HTTPException) as exc:
        await ds.svc_undo_admin_review(
            sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID,
        )

    assert exc.value.status_code == 409
    assert "already been undone" in exc.value.detail


def test_reversible_lookup_takes_a_row_lock():
    """Serialises concurrent undo attempts; the loser hits the consumed guard."""
    assert "with_for_update" in inspect.getsource(ds._fetch_open_reversible_for_update)


# ── 7/8. Unknown id, wrong tenant, non-whitelisted action ─────────────────────

async def test_unknown_or_cross_tenant_id_is_404(make_session, fake_result, stubs):
    sess = _queue(make_session, fake_result, site=_site(), reversible=None)

    with pytest.raises(HTTPException) as exc:
        await ds.svc_undo_admin_review(
            sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID,
        )
    assert exc.value.status_code == 404


def test_reversible_lookup_is_tenant_and_site_scoped():
    src = inspect.getsource(ds._fetch_open_reversible_for_update)
    assert "tenant_id ==" in src
    assert "site_id ==" in src


async def test_a_non_whitelisted_action_cannot_be_undone(make_session, fake_result, stubs):
    sess = _queue(make_session, fake_result, site=_site(),
                  reversible=_reversible(action="design_gfc_decided"),
                  review=_review(), deliverable=_deliverable())

    with pytest.raises(HTTPException) as exc:
        await ds.svc_undo_admin_review(
            sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID,
        )
    assert exc.value.status_code == 409
    assert "not an undoable action" in exc.value.detail


# ── 9. Snapshot written by older code ─────────────────────────────────────────

async def test_unrecognised_snapshot_version_refuses_rather_than_guessing(
    make_session, fake_result, stubs,
):
    site, review, deliv = _site(), _review(), _deliverable()
    sess = _queue(make_session, fake_result, site=site,
                  reversible=_reversible(snapshot=_snapshot(version=999)),
                  review=review, deliverable=deliv)

    with pytest.raises(HTTPException) as exc:
        await ds.svc_undo_admin_review(
            sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID,
        )

    assert exc.value.status_code == 409
    assert "older version" in exc.value.detail
    assert deliv.admin_status == "approved"   # no partial restore


# ── 10. Reject inverts too ────────────────────────────────────────────────────

async def test_undo_of_a_reject_restores_the_deliverable_status(
    make_session, fake_result, stubs,
):
    """A reject flips status approved->rejected; the undo must put it back."""
    snap = _snapshot(
        before={
            "deliverable": {"status": "approved", "admin_status": "pending",
                            "admin_reviewed_by": None, "admin_reviewed_at": None,
                            "admin_comments": None},
            "review": {"current_stage": "3d", "approved_by": None},
            "site": {"design_status": "in_progress"},
        },
        after={
            "deliverable": {"status": "rejected", "admin_status": "pending",
                            "admin_reviewed_by": ADMIN["sub"],
                            "admin_reviewed_at": "2026-07-21T12:00:00+00:00",
                            "admin_comments": "Redo the elevation."},
            "review": {"current_stage": "3d", "approved_by": None},
            "site": {"design_status": "in_progress"},
        },
    )
    snap["decision"] = "reject"
    deliv = _deliverable(status="rejected", admin_status="pending")
    deliv.admin_comments = "Redo the elevation."
    review = _review(current_stage="3d")
    sess = _queue(make_session, fake_result, site=_site(),
                  reversible=_reversible(snapshot=snap), review=review, deliverable=deliv)

    await ds.svc_undo_admin_review(
        sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID,
    )

    assert deliv.status == "approved"      # back to awaiting admin
    assert deliv.admin_status == "pending"
    assert deliv.admin_comments is None


# ── 11. Deliverable vanished ──────────────────────────────────────────────────

async def test_missing_deliverable_is_404(make_session, fake_result, stubs):
    sess = _queue(make_session, fake_result, site=_site(), reversible=_reversible(),
                  review=_review(), deliverable=None)

    with pytest.raises(HTTPException) as exc:
        await ds.svc_undo_admin_review(
            sess, tenant_id=TENANT, actor=ADMIN, site_id=SITE_ID, reversible_id=REV_ID,
        )
    assert exc.value.status_code == 404
    assert "no longer exists" in exc.value.detail


# ── Listing ───────────────────────────────────────────────────────────────────

async def test_listing_is_scoped_to_the_calling_admin():
    """Returning another admin's rows would render a button that always 403s."""
    src = inspect.getsource(ds.svc_list_reversible_actions)
    assert "ReversibleAction.actor_id == actor" in src
    assert "consumed_at.is_(None)" in src
    assert "tenant_id ==" in src


async def test_listing_returns_nothing_for_a_non_admin(make_session, fake_result):
    sess = make_session(fake_result(scalar=_site()))
    out = await ds.svc_list_reversible_actions(
        sess, tenant_id=TENANT, actor={"sub": "x", "role": "supervisor"}, site_id=SITE_ID,
    )
    assert out == []


# ── Regression guards on the shared design flow ───────────────────────────────

def test_admin_tier_still_covers_2d_and_3d_only():
    assert ds._NEEDS_ADMIN == frozenset({"2d", "3d"})
    assert ds._NEXT_STAGE["3d"] == "gfc"


def test_two_stage_gfc_still_holds():
    """The undo restores design_status verbatim, so it must not resurrect the
    auto-open behaviour the two-stage change removed."""
    src = inspect.getsource(ds._advance_stage_after_approval)
    assert 'site.design_status = "gfc_pending"' not in src
