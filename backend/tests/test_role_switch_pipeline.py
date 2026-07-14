"""Role-switch pipeline consistency + self-approval deadlock fix.

Locks the behaviour that un-deadlocks a BD supervisor who switches to the
executive role (X-Override-Role) to create a pipeline, then approves it back as
themselves — where ``submitted_by`` equals their own user id (no live DB; see
conftest.py philosophy):

1. Every created draft enters the pipeline as DRAFT_SUBMITTED, including a
   supervisor's own. There is no more "supervisor auto-promote to SHORTLISTED",
   so the lifecycle is identical for everyone.

2. A supervisor may shortlist (approve) a draft they submitted. Approval routes
   are already supervisor-gated, so the old submitter==approver 403 only ever
   fired against a supervisor and dead-ended the role-switch flow.

3. Segregation of duties still holds for anyone WITHOUT supervisor authority:
   a plain executive cannot approve their own submission.
"""
from __future__ import annotations

import datetime
import uuid

import pytest
from fastapi import HTTPException

from app.db import models
from app.domain.state_machine import SiteStatus
from app.services import bd_service
from tests.conftest import RecordingSession

pytestmark = pytest.mark.asyncio

TENANT = "00000000-0000-0000-0000-000000000002"


def _supervisor(sub=None):
    return {"sub": str(sub or uuid.uuid4()), "role": "supervisor", "name": "Sup"}


def _executive(sub=None):
    return {"sub": str(sub or uuid.uuid4()), "role": "executive", "name": "Exec"}


async def _noop_audit(*a, **k):
    return None


async def _noop_notify(*a, **k):
    return None


async def _no_owners(*a, **k):
    return []


async def _name(*a, **k):
    return "Sup"


# ── 1. supervisor-created drafts enter the pipeline ────────────────────────────

async def test_supervisor_created_draft_enters_pipeline(monkeypatch):
    """A supervisor's own draft lands in DRAFT_SUBMITTED, not auto-shortlisted."""
    monkeypatch.setattr(bd_service, "write_audit_event", _noop_audit)
    monkeypatch.setattr(bd_service, "_notify_draft_submission", _noop_notify)

    session = RecordingSession()
    await bd_service.svc_create_draft(
        session,
        tenant_id=TENANT,
        actor=_supervisor(),
        name="Role-switch Site",
        city="Mumbai",
        visit_date=datetime.date(2026, 7, 14),
    )
    site = session.added[0]
    assert site.status == SiteStatus.DRAFT_SUBMITTED.value
    assert site.shortlisted_at is None
    assert site.supervisor_id is None


# ── 2. the deadlock fix: a supervisor can shortlist their own draft ────────────

async def test_supervisor_can_shortlist_own_draft(monkeypatch):
    """Reproduces the role-switch deadlock: same user id created and approves."""
    me = uuid.uuid4()
    site = models.Site(
        id=uuid.uuid4(), tenant_id=TENANT,
        status=SiteStatus.DRAFT_SUBMITTED.value,
        name="Self", city="Pune", submitted_by=me,
    )

    async def _fetch(session, *, site_id, tenant_id):
        return site

    monkeypatch.setattr(bd_service, "fetch_site_for_update_or_404", _fetch)
    monkeypatch.setattr(bd_service, "write_audit_event", _noop_audit)
    monkeypatch.setattr(bd_service, "recipients_for_site_owner", _no_owners)
    monkeypatch.setattr(bd_service, "notify_enqueue", _noop_notify)
    monkeypatch.setattr(bd_service, "fetch_user_name", _name)

    out = await bd_service.svc_shortlist_draft(
        RecordingSession(), tenant_id=TENANT, actor=_supervisor(me), site_id=site.id,
    )
    assert site.status == SiteStatus.SHORTLISTED.value
    assert str(site.supervisor_id) == str(me)
    assert out.status == SiteStatus.SHORTLISTED.value


# ── 3. segregation of duties still holds for non-supervisors ───────────────────

async def test_executive_cannot_self_approve_defence_in_depth():
    """The guard still bites a caller with no supervisor authority."""
    me = uuid.uuid4()
    site = models.Site(
        id=uuid.uuid4(), tenant_id=TENANT,
        status=SiteStatus.DRAFT_SUBMITTED.value,
        name="X", city="Delhi", submitted_by=me,
    )
    with pytest.raises(HTTPException) as exc:
        bd_service._assert_not_self_approval(_executive(me), site)
    assert exc.value.status_code == 403


async def test_supervisor_self_approval_allowed_by_guard():
    """Same site, same user id — but a supervisor passes the guard."""
    me = uuid.uuid4()
    site = models.Site(
        id=uuid.uuid4(), tenant_id=TENANT,
        status=SiteStatus.DRAFT_SUBMITTED.value,
        name="X", city="Delhi", submitted_by=me,
    )
    # Must not raise.
    bd_service._assert_not_self_approval(_supervisor(me), site)
