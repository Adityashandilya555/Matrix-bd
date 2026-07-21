"""Two-stage GFC approval.

Before this change, approving the 3D deliverable *silently* flipped the site to
``design_status='gfc_pending'``, which is the signal that puts it in the business
admin's GFC queue. Nobody ever pressed anything — GFC was a side effect.

Now it is an explicit, role-aware step:

* executive uploads 3D → supervisor reviews → business admin approves the 3D
* supervisor self-uploads 3D (auto-approved) → business admin approves the 3D
* **either way**, the SUPERVISOR then presses "Send for GFC approval"
  (``svc_request_gfc_approval``), and only that sets ``gfc_pending``.

The intermediate state is the ``(current_stage='gfc', design_status='in_progress')``
pair — reachable only after full 3D approval, so it can't collide with the
recce/2d/3d phase. No migration: both values already exist.

These tests lock that the auto-transition stays gone and the explicit gate keeps
gating.
"""
from __future__ import annotations

import inspect

import pytest
from fastapi import HTTPException

from app.db import models
from app.services import design_service as ds

TENANT = "22222222-2222-2222-2222-222222222222"
SITE_ID = "11111111-1111-1111-1111-111111111111"
ACTOR = {"sub": "33333333-3333-3333-3333-333333333333", "name": "Sup Ervisor",
         "role": "supervisor"}


def _site(design_status: str) -> models.Site:
    site = models.Site(tenant_id=TENANT, name="Test Site", code="TS-001")
    site.id = SITE_ID
    site.design_status = design_status
    return site


def _review(current_stage: str, **kw) -> models.DesignReview:
    review = models.DesignReview(tenant_id=TENANT, site_id=SITE_ID)
    review.current_stage = current_stage
    review.gfc_status = kw.get("gfc_status", "pending")
    review.gfc_decided_by = kw.get("gfc_decided_by")
    review.gfc_decided_at = kw.get("gfc_decided_at")
    review.gfc_comments = kw.get("gfc_comments")
    return review


@pytest.fixture
def stub_side_effects(monkeypatch):
    """Neutralise the IO around the mutation and record the notifications.

    ``_build_design_response`` and the notification helpers each fan out into
    several queries; the behaviour under test is the state mutation, so stub
    them and assert on what was *asked for*.
    """
    events: list[dict] = []
    audits: list[dict] = []

    async def _fake_notify(_session, **kw):
        events.append(kw)

    async def _fake_audit(_session, **kw):
        audits.append(kw)

    async def _fake_admins(_session, **_kw):
        return ["admin-1"]

    async def _fake_supervisors(_session, **_kw):
        return ["sup-1"]

    async def _fake_response(_session, site):
        return site

    monkeypatch.setattr(ds, "notify_enqueue", _fake_notify)
    monkeypatch.setattr(ds, "write_audit_event", _fake_audit)
    monkeypatch.setattr(ds, "recipients_for_business_admins", _fake_admins)
    monkeypatch.setattr(ds, "recipients_for_design_supervisors", _fake_supervisors)
    monkeypatch.setattr(ds, "_build_design_response", _fake_response)
    return {"events": events, "audits": audits}


# ── Source invariants ─────────────────────────────────────────────────────────

def test_advance_no_longer_auto_opens_the_gfc_gate():
    """The 3D-approval path must NOT set gfc_pending — that's the whole change."""
    src = inspect.getsource(ds._advance_stage_after_approval)
    assert 'site.design_status = "gfc_pending"' not in src
    assert 'site.design_status = "in_progress"' in src
    # The admin notify moved out; supervisors are told to send it instead.
    assert "recipients_for_business_admins" not in src
    assert "design_gfc_ready" in src


def test_only_the_explicit_request_opens_the_gfc_gate():
    src = inspect.getsource(ds.svc_request_gfc_approval)
    assert 'site.design_status = "gfc_pending"' in src
    assert "write_audit_event" in src           # audit trail is non-negotiable
    assert "notify_enqueue" in src
    assert "recipients_for_business_admins" in src
    assert "async with transaction(" in src     # owns its own transaction
    assert "fetch_site_for_update_or_404" in src  # row-locks against double-send


def test_request_gfc_has_no_service_level_role_check():
    """require_role(SUPERVISOR) admits business_admin on purpose — that bypass is
    the escape hatch when the owning supervisor is unavailable. A hard-coded
    role check in the service (as svc_gfc_decision has) would defeat it."""
    src = inspect.getsource(ds.svc_request_gfc_approval)
    # Strip the docstring: it *explains* the bypass, so a naive substring check
    # would match the prose rather than a real guard.
    body = src.replace(inspect.getdoc(ds.svc_request_gfc_approval) or "", "")
    assert 'role") or ""' not in body
    assert "actor_is_business_admin" not in body
    assert "HTTP_403_FORBIDDEN" not in body


def test_request_gfc_params_are_keyword_only():
    params = list(inspect.signature(ds.svc_request_gfc_approval).parameters.values())
    assert params[0].name == "session"
    assert all(p.kind is inspect.Parameter.KEYWORD_ONLY for p in params[1:])


def test_deliverable_stage_map_unchanged():
    """Both business-admin approvals are retained, so 3D still needs admin sign-off.
    Mirrors test_project_excellence_shared_budget.py — keeps both files honest."""
    assert ds._NEEDS_ADMIN == frozenset({"2d", "3d"})
    assert "boq" not in ds._NEXT_STAGE
    assert ds._NEXT_STAGE["3d"] == "gfc"


def test_router_exposes_gfc_request_under_supervisor_guard():
    import app.routers.design as design_router
    src = inspect.getsource(design_router)
    assert '"/{site_id}/gfc-request"' in src
    assert "svc_request_gfc_approval" in src
    handler = inspect.getsource(design_router.request_gfc_approval)
    assert "DesignSupervisor" in handler


# ── Behaviour: the happy path ─────────────────────────────────────────────────

async def test_request_gfc_opens_the_gate_and_notifies_admins(
    make_session, fake_result, stub_side_effects,
):
    site = _site("in_progress")
    review = _review("gfc")
    sess = make_session(fake_result(scalar=site), fake_result(scalar=review))

    await ds.svc_request_gfc_approval(
        sess, tenant_id=TENANT, actor=ACTOR, site_id=SITE_ID,
    )

    assert site.design_status == "gfc_pending"
    actions = [a["action"] for a in stub_side_effects["audits"]]
    assert "design_gfc_requested" in actions
    events = [e["event"] for e in stub_side_effects["events"]]
    assert "design_gfc_pending" in events


async def test_request_gfc_clears_a_stale_rejection(
    make_session, fake_result, stub_side_effects,
):
    """Re-sending after a GFC rejection must not leave the old verdict showing —
    the UI badge reads gfc_status, and 'Sent back' over a live request is wrong.
    gfc_comments is deliberately KEPT as context."""
    site = _site("in_progress")
    review = _review(
        "gfc", gfc_status="rejected", gfc_decided_by="admin-1",
        gfc_decided_at="2026-07-01", gfc_comments="Fix the elevation.",
    )
    sess = make_session(fake_result(scalar=site), fake_result(scalar=review))

    await ds.svc_request_gfc_approval(
        sess, tenant_id=TENANT, actor=ACTOR, site_id=SITE_ID,
    )

    assert review.gfc_status == "pending"
    assert review.gfc_decided_by is None
    assert review.gfc_decided_at is None
    assert review.gfc_comments == "Fix the elevation."   # kept on purpose


# ── Behaviour: the guards ─────────────────────────────────────────────────────

@pytest.mark.parametrize(
    ("stage", "design_status", "fragment"),
    [
        ("3d", "in_progress", "not ready for GFC"),        # 3D not approved yet
        ("recce", "in_progress", "not ready for GFC"),
        ("gfc", "gfc_pending", "already been sent"),        # double-send
        ("gfc", "approved", "already approved"),
    ],
)
async def test_request_gfc_rejects_wrong_state(
    make_session, fake_result, stub_side_effects, stage, design_status, fragment,
):
    site = _site(design_status)
    review = _review(stage)
    sess = make_session(fake_result(scalar=site), fake_result(scalar=review))

    with pytest.raises(HTTPException) as exc:
        await ds.svc_request_gfc_approval(
            sess, tenant_id=TENANT, actor=ACTOR, site_id=SITE_ID,
        )

    assert exc.value.status_code == 422
    assert fragment in exc.value.detail
    assert stub_side_effects["events"] == []   # nothing was announced


# ── Behaviour: 3D approval lands in the pre-send state ────────────────────────

async def test_3d_approval_stops_short_of_the_admin_queue(
    make_session, fake_result, stub_side_effects,
):
    """The headline behaviour change: admins do NOT see the site yet."""
    site = _site("in_progress")
    review = _review("3d")
    sess = make_session()

    await ds._advance_stage_after_approval(
        sess, tenant_id=TENANT, actor=ACTOR, site=site, review=review, kind="3d",
    )

    assert review.current_stage == "gfc"
    assert site.design_status == "in_progress"     # NOT gfc_pending
    events = [e["event"] for e in stub_side_effects["events"]]
    assert "design_gfc_pending" not in events      # admins not paged yet
    assert "design_gfc_ready" in events            # supervisor is told to send


async def test_2d_approval_path_unchanged(
    make_session, fake_result, stub_side_effects,
):
    """Regression guard on the shared helper — only the gfc branch changed."""
    site = _site("in_progress")
    review = _review("2d")
    sess = make_session()

    await ds._advance_stage_after_approval(
        sess, tenant_id=TENANT, actor=ACTOR, site=site, review=review, kind="2d",
    )

    assert review.current_stage == "3d"
    assert site.design_status == "in_progress"


# ── Behaviour: the admin gate still gates ─────────────────────────────────────

async def test_gfc_decision_still_rejects_the_pre_send_state(
    make_session, fake_result, stub_side_effects,
):
    """An admin must not be able to sign off a site the supervisor never sent."""
    from app.domain.schemas.design import GfcDecisionRequest

    site = _site("in_progress")      # ready-to-send, not yet sent
    review = _review("gfc")
    sess = make_session(fake_result(scalar=site), fake_result(scalar=review))

    with pytest.raises(HTTPException) as exc:
        await ds.svc_gfc_decision(
            sess, tenant_id=TENANT,
            actor={**ACTOR, "role": "business_admin"}, site_id=SITE_ID,
            body=GfcDecisionRequest(decision="approve"),
        )

    assert exc.value.status_code == 422
    assert "not awaiting GFC" in exc.value.detail
