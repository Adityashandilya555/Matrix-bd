"""Role flexibility: delegate-to-self + business-admin workspace access.

Locks the fixes that un-deadlock the role-flexibility feature (no live DB —
see conftest.py philosophy):

1. A supervisor (or business admin) can take a site's executive work on
   THEMSELVES — self-delegation under their own user id — in BD shortlist,
   Legal, Design, Project, Project Excellence, and Financial Closure. The old
   "Cannot delegate to yourself" + "delegate must be role executive" pair made
   PR #343's "Delegate to self (me)" option 400 everywhere, which dead-ended
   any module whose team had no executive.

2. Delegating to ANOTHER non-executive stays rejected — role flexibility never
   grants access through someone else's id.

3. Service-level supervisor gates accept business admins. The router guards
   (require_role/require_module) always passed business_admin, but the service
   role-string checks 403'd them — and X-Override-Role simulation means the
   effective role can differ from the DB role, so the checks look at
   ``real_role`` too (see _common.actor_is_business_admin).
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.db import models
from app.services import (
    bd_service,
    delegation_service,
    design_service,
    financial_closure_service,
    project_excellence_service,
    project_service,
)
from app.services._common import actor_can_supervise, actor_is_business_admin
from tests.conftest import FakeResult, RecordingSession


# ── builders ──────────────────────────────────────────────────────────────────

TENANT = uuid.uuid4()


def _site(**kw):
    base = dict(
        id=uuid.uuid4(), tenant_id=TENANT, status="in_project",
        name="poker", city="Bengaluru", submitted_by=uuid.uuid4(),
        ca_code="CA-406", design_status="approved",
        legal_dd_status="positive", finance_status="approved",
        financial_closure_status="open",
    )
    base.update(kw)
    return models.Site(**base)


def _user(*, role, user_id=None, active=True):
    return models.User(
        id=user_id or uuid.uuid4(), tenant_id=TENANT, role=role,
        email=f"{role}@x.co", name=role.title(), is_active=active,
    )


def _supervisor(sub=None):
    return {"sub": str(sub or uuid.uuid4()), "role": "supervisor", "name": "Sup"}


def _business_admin(sub=None, *, simulating=None):
    """A business admin; ``simulating`` mimics an active X-Override-Role."""
    return {
        "sub": str(sub or uuid.uuid4()),
        "role": simulating or "business_admin",
        "real_role": "business_admin",
        "name": "Admin",
    }


def _executive(sub=None):
    return {"sub": str(sub or uuid.uuid4()), "role": "executive", "name": "Exec"}


async def _noop_audit(*a, **k):
    return None


async def _noop_notify(*a, **k):
    return None


# ── 0. helper semantics ────────────────────────────────────────────────────────

def test_actor_helpers_recognize_business_admin_under_override():
    raw = _business_admin()
    simulating_exec = _business_admin(simulating="executive")
    simulating_sup = _business_admin(simulating="supervisor")
    sup = _supervisor()
    ex = _executive()
    assert actor_is_business_admin(raw)
    assert actor_is_business_admin(simulating_exec)
    assert actor_is_business_admin(simulating_sup)
    assert not actor_is_business_admin(sup)
    assert not actor_is_business_admin(ex)
    assert actor_can_supervise(raw)
    assert actor_can_supervise(simulating_exec)
    assert actor_can_supervise(sup)
    assert not actor_can_supervise(ex)


# ── 1. business admin passes the module work gates ─────────────────────────────

@pytest.mark.parametrize("actor", [
    {"role": "business_admin", "sub": str(uuid.uuid4())},
    {"role": "executive", "real_role": "business_admin", "sub": str(uuid.uuid4())},
])
async def test_business_admin_can_work_project_pe_fc(actor):
    session = RecordingSession()
    # Previously 403 "access denied" — business admin is neither supervisor
    # nor a delegated executive. Must be a clean pass now, no queries needed.
    await project_service._assert_can_work_project(
        session, tenant_id=TENANT, actor=actor, site_id=uuid.uuid4())
    await project_excellence_service._assert_can_work_pe(
        session, tenant_id=TENANT, actor=actor, site_id=uuid.uuid4())
    await financial_closure_service._assert_can_work_fc(
        session, tenant_id=TENANT, actor=actor, site_id=uuid.uuid4())
    assert session.executed == []


async def test_plain_executive_still_needs_delegation(monkeypatch):
    async def _not_delegated(*a, **k):
        return False
    monkeypatch.setattr(project_service, "svc_is_delegated", _not_delegated)
    with pytest.raises(HTTPException) as exc:
        await project_service._assert_can_work_project(
            RecordingSession(), tenant_id=TENANT, actor=_executive(), site_id=uuid.uuid4())
    assert exc.value.status_code == 403


# ── 2. Project: self-allocation + target rules ────────────────────────────────

def _patch_project(monkeypatch, site, review):
    async def _fetch_site(session, *, site_id, tenant_id):
        return site

    async def _fetch_review(session, *, site):
        return review

    async def _build(session, s, r):
        return {"ok": True}

    monkeypatch.setattr(project_service, "fetch_site_for_update_or_404", _fetch_site)
    monkeypatch.setattr(project_service, "_fetch_review_or_create", _fetch_review)
    monkeypatch.setattr(project_service, "_build_response", _build)
    monkeypatch.setattr(project_service, "write_audit_event", _noop_audit)


async def test_supervisor_can_self_allocate_project(monkeypatch):
    site = _site()
    review = models.ProjectReview(tenant_id=TENANT, site_id=site.id)
    _patch_project(monkeypatch, site, review)
    me = uuid.uuid4()
    actor = _supervisor(me)
    session = RecordingSession([
        FakeResult(scalar=_user(role="supervisor", user_id=me)),  # delegate lookup: myself
        FakeResult(scalar=None),                                   # no existing delegation
    ])
    await project_service.svc_allocate_project(
        session, tenant_id=TENANT, actor=actor, site_id=site.id, delegate_user_id=me,
    )
    added = [o for o in session.added if isinstance(o, models.SiteDelegation)]
    assert len(added) == 1
    assert str(added[0].delegate_user_id) == str(me)
    assert review.allocated_to == me
    assert review.project_status == "allocated"


async def test_business_admin_simulating_supervisor_can_self_allocate_project(monkeypatch):
    site = _site()
    review = models.ProjectReview(tenant_id=TENANT, site_id=site.id)
    _patch_project(monkeypatch, site, review)
    me = uuid.uuid4()
    actor = _business_admin(me, simulating="supervisor")
    session = RecordingSession([
        FakeResult(scalar=_user(role="business_admin", user_id=me)),
        FakeResult(scalar=None),
    ])
    await project_service.svc_allocate_project(
        session, tenant_id=TENANT, actor=actor, site_id=site.id, delegate_user_id=me,
    )
    assert review.allocated_to == me


async def test_project_allocation_to_another_supervisor_still_rejected(monkeypatch):
    site = _site()
    review = models.ProjectReview(tenant_id=TENANT, site_id=site.id)
    _patch_project(monkeypatch, site, review)
    other_supervisor = _user(role="supervisor")
    with pytest.raises(HTTPException) as exc:
        await project_service.svc_allocate_project(
            RecordingSession([FakeResult(scalar=other_supervisor)]),
            tenant_id=TENANT, actor=_supervisor(), site_id=site.id,
            delegate_user_id=other_supervisor.id,
        )
    assert exc.value.status_code == 404  # "Active executive not found."


async def test_executive_cannot_allocate_project():
    with pytest.raises(HTTPException) as exc:
        await project_service.svc_allocate_project(
            RecordingSession(), tenant_id=TENANT, actor=_executive(),
            site_id=uuid.uuid4(), delegate_user_id=uuid.uuid4(),
        )
    assert exc.value.status_code == 403


async def test_business_admin_can_revoke_project_delegation():
    # Previously 403 before even looking at the row; now falls through to the
    # idempotent "nothing to revoke" path.
    out = await project_service.svc_revoke_project_delegation(
        RecordingSession([FakeResult(scalar=None)]),
        tenant_id=TENANT, actor=_business_admin(),
        site_id=uuid.uuid4(), delegate_user_id=uuid.uuid4(),
    )
    assert "No active" in out.message


# ── 3. Project Excellence: self-allocation ─────────────────────────────────────

async def test_supervisor_can_self_allocate_pe(monkeypatch):
    site = _site()
    budget = models.SiteBudget(
        id=uuid.uuid4(), site_id=site.id, tenant_id=TENANT, phase="gfc", status="draft",
    )

    async def _fetch_site(session, *, site_id, tenant_id):
        return site

    async def _fetch_or_create(session, *, site, phase):
        return budget

    async def _build(session, s, b):
        return {"ok": True}

    monkeypatch.setattr(project_excellence_service, "fetch_site_for_update_or_404", _fetch_site)
    monkeypatch.setattr(
        project_excellence_service.budget_service, "fetch_or_create_budget", _fetch_or_create)
    monkeypatch.setattr(project_excellence_service, "_build_response", _build)
    monkeypatch.setattr(project_excellence_service, "write_audit_event", _noop_audit)

    me = uuid.uuid4()
    session = RecordingSession([
        FakeResult(scalar=_user(role="supervisor", user_id=me)),
        FakeResult(scalar=None),
    ])
    await project_excellence_service.svc_allocate_pe(
        session, tenant_id=TENANT, actor=_supervisor(me), site_id=site.id, delegate_user_id=me,
    )
    assert budget.allocated_to == me
    assert site.project_excellence_status == "allocated"


async def test_business_admin_can_review_pe_budget_gate(monkeypatch):
    # Gate check only: a pending_admin budget is not awaiting supervisor, so the
    # call must fail on the 422 state guard — NOT the old 403 role guard.
    budget = models.SiteBudget(
        id=uuid.uuid4(), site_id=uuid.uuid4(), tenant_id=TENANT, phase="gfc",
        status="pending_admin",
    )

    class _Body:
        decision = "approve"
        comments = None

    async def _fetch_site(session, *, site_id, tenant_id):
        return _site()

    async def _fetch_or_create(session, *, site, phase):
        return budget

    monkeypatch.setattr(project_excellence_service, "fetch_site_for_update_or_404", _fetch_site)
    monkeypatch.setattr(
        project_excellence_service.budget_service, "fetch_or_create_budget", _fetch_or_create)
    with pytest.raises(HTTPException) as exc:
        await project_excellence_service.svc_review_pe_budget(
            RecordingSession(), tenant_id=TENANT, actor=_business_admin(),
            site_id=budget.site_id, body=_Body(),
        )
    assert exc.value.status_code == 422  # state guard, not the role guard


# ── 4. Financial Closure: self-allocation ──────────────────────────────────────

async def test_supervisor_can_self_allocate_fc(monkeypatch):
    site = _site()
    closure = models.SiteBudget(
        id=uuid.uuid4(), site_id=site.id, tenant_id=TENANT, phase="closure", status="draft",
    )

    async def _fetch_site(session, *, site_id, tenant_id):
        return site

    async def _fetch_or_create(session, *, site, phase):
        return closure

    async def _build(session, s, b):
        return {"ok": True}

    monkeypatch.setattr(financial_closure_service, "fetch_site_for_update_or_404", _fetch_site)
    monkeypatch.setattr(
        financial_closure_service.budget_service, "fetch_or_create_budget", _fetch_or_create)
    monkeypatch.setattr(financial_closure_service, "_build_fc_state", _build)
    monkeypatch.setattr(financial_closure_service, "write_audit_event", _noop_audit)

    me = uuid.uuid4()
    session = RecordingSession([
        FakeResult(scalar=_user(role="supervisor", user_id=me)),
        FakeResult(scalar=None),
    ])
    await financial_closure_service.svc_allocate_fc(
        session, tenant_id=TENANT, actor=_supervisor(me), site_id=site.id, delegate_user_id=me,
    )
    assert closure.allocated_to == me
    assert site.financial_closure_status == "allocated"


# ── 5. BD shortlist + Legal: self-delegation ───────────────────────────────────

async def test_supervisor_can_self_delegate_shortlist(monkeypatch):
    site = _site()

    async def _fetch_site(session, *, site_id, tenant_id):
        return site

    monkeypatch.setattr(delegation_service, "fetch_site_for_update_or_404", _fetch_site)
    monkeypatch.setattr(delegation_service, "write_audit_event", _noop_audit)

    me = uuid.uuid4()
    session = RecordingSession([
        FakeResult(scalar=_user(role="supervisor", user_id=me)),
        FakeResult(scalar=None),
    ])
    out = await delegation_service.svc_grant_delegation(
        session, tenant_id=TENANT, actor=_supervisor(me), site_id=site.id,
        delegate_user_id=me, notes="taking this one myself",
    )
    assert out["delegate_user_id"] == str(me)


async def test_shortlist_delegation_to_other_supervisor_still_rejected(monkeypatch):
    site = _site()

    async def _fetch_site(session, *, site_id, tenant_id):
        return site

    monkeypatch.setattr(delegation_service, "fetch_site_for_update_or_404", _fetch_site)
    other = _user(role="supervisor")
    with pytest.raises(HTTPException) as exc:
        await delegation_service.svc_grant_delegation(
            RecordingSession([FakeResult(scalar=other)]),
            tenant_id=TENANT, actor=_supervisor(), site_id=site.id,
            delegate_user_id=other.id,
        )
    assert exc.value.status_code == 400


async def test_supervisor_can_self_delegate_legal(monkeypatch):
    site = _site()

    async def _fetch_site(session, *, site_id, tenant_id):
        return site

    from app.services import notification_service
    monkeypatch.setattr(delegation_service, "fetch_site_for_update_or_404", _fetch_site)
    monkeypatch.setattr(delegation_service, "write_audit_event", _noop_audit)
    monkeypatch.setattr(notification_service, "enqueue", _noop_notify)

    me = uuid.uuid4()
    session = RecordingSession([
        FakeResult(scalar=_user(role="supervisor", user_id=me)),
        FakeResult(scalar=None),
    ])
    out = await delegation_service.svc_delegate_legal(
        session, tenant_id=TENANT, actor=_supervisor(me), site_id=site.id,
        delegate_user_id=me,
    )
    assert out["delegate_user_id"] == str(me)
    assert out["module"] == "legal"


# ── 6. Design: self-allocation + business-admin submit path ───────────────────

async def test_supervisor_can_self_allocate_design(monkeypatch):
    site = _site(design_status="pending")

    async def _fetch_site(session, *, site_id, tenant_id):
        return site

    async def _no_review(session, *, site_id):
        return None

    async def _build(session, s):
        return {"ok": True}

    monkeypatch.setattr(design_service, "fetch_site_for_update_or_404", _fetch_site)
    monkeypatch.setattr(design_service, "_fetch_review_or_none", _no_review)
    monkeypatch.setattr(design_service, "_build_design_response", _build)
    monkeypatch.setattr(design_service, "write_audit_event", _noop_audit)
    monkeypatch.setattr(design_service, "notify_enqueue", _noop_notify)

    me = uuid.uuid4()
    session = RecordingSession([
        FakeResult(scalar=_user(role="supervisor", user_id=me)),
        FakeResult(scalar=None),
    ])
    await design_service.svc_allocate_design(
        session, tenant_id=TENANT, actor=_supervisor(me), site_id=site.id, delegate_user_id=me,
    )
    reviews = [o for o in session.added if isinstance(o, models.DesignReview)]
    assert len(reviews) == 1
    assert reviews[0].reviewed_by == me
    assert site.design_status == "allocated"


async def test_business_admin_passes_design_submit_gate(monkeypatch):
    """A business admin (real_role) uploading as executive needs no allocation."""
    site = _site()
    review = models.DesignReview(site_id=site.id, tenant_id=TENANT, current_stage="recce")

    async def _existing_review(session, *, site_id):
        return review

    monkeypatch.setattr(design_service, "_fetch_review_or_none", _existing_review)
    actor = _business_admin(simulating="executive")
    out = await design_service._resolve_design_review(
        RecordingSession(), tenant_id=TENANT, actor=actor, site=site,
        site_id=site.id, kind="recce", is_supervisor=False,
    )
    assert out is review  # no delegation query, no 403


# ── 7. BD reassign: supervisor may take the site themselves ───────────────────

async def test_reassign_site_supervisor_can_take_self(monkeypatch):
    site = _site()

    async def _fetch_site(session, *, site_id, tenant_id):
        return site

    monkeypatch.setattr(bd_service, "fetch_site_for_update_or_404", _fetch_site)
    monkeypatch.setattr(bd_service, "write_audit_event", _noop_audit)
    monkeypatch.setattr(bd_service, "notify_enqueue", _noop_notify)

    me = uuid.uuid4()
    session = RecordingSession([FakeResult(scalar=_user(role="supervisor", user_id=me))])
    out = await bd_service.svc_reassign_site(
        session, tenant_id=TENANT, actor=_supervisor(me), site_id=site.id, new_owner_id=me,
    )
    assert site.assigned_to == me
    assert "reassigned" in out.message


async def test_reassign_site_to_other_supervisor_still_rejected(monkeypatch):
    site = _site()

    async def _fetch_site(session, *, site_id, tenant_id):
        return site

    monkeypatch.setattr(bd_service, "fetch_site_for_update_or_404", _fetch_site)
    other = _user(role="supervisor")
    with pytest.raises(HTTPException) as exc:
        await bd_service.svc_reassign_site(
            RecordingSession([FakeResult(scalar=other)]),
            tenant_id=TENANT, actor=_supervisor(), site_id=site.id, new_owner_id=other.id,
        )
    assert exc.value.status_code == 422
