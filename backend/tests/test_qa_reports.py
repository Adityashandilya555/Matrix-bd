"""Quality-audit report unread logic (before/after PDF reports).

Locks the rule the feature hinges on: the Project NSO-Handover "View" button is
unread (yellow) whenever a report was pushed more recently than Project last
opened them — so pushing the 'after' (secondary) report re-flags a site that
Project had already viewed. No live DB (pure function).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.db import models
from app.services import project_service
from app.services.project_service import _qa_reports_unread
from tests.conftest import FakeResult, RecordingSession

TENANT = uuid.uuid4()


def _user(*, role, user_id=None):
    return models.User(id=user_id or uuid.uuid4(), tenant_id=TENANT, role=role,
                       email=f"{role}@x.co", name=role.title(), is_active=True)


def _site():
    return models.Site(id=uuid.uuid4(), tenant_id=TENANT, name="poker", city="Bengaluru")


def _supervisor(sub=None):
    return {"sub": str(sub or uuid.uuid4()), "role": "supervisor", "name": "Sup"}


async def _noop_audit(*a, **k):
    return None

T0 = datetime(2026, 7, 20, 9, 0, tzinfo=timezone.utc)


class _Report:
    """Stand-in for a QualityAuditReport row — only pushed_at matters here."""
    def __init__(self, pushed_at):
        self.pushed_at = pushed_at


def test_unread_false_when_nothing_pushed():
    assert _qa_reports_unread(_Report(None), _Report(None), None) is False
    assert _qa_reports_unread(None, None, T0) is False


def test_unread_true_when_pushed_but_never_viewed():
    assert _qa_reports_unread(_Report(T0), None, None) is True


def test_unread_false_once_viewed_after_the_push():
    assert _qa_reports_unread(_Report(T0), None, T0 + timedelta(hours=1)) is False


def test_unread_retriggers_when_after_pushed_post_view():
    # 'before' pushed + viewed, then 'after' pushed later → unread again.
    before = _Report(T0)
    viewed = T0 + timedelta(hours=1)
    after = _Report(T0 + timedelta(hours=2))
    assert _qa_reports_unread(before, after, viewed) is True


def test_unread_uses_latest_push_vs_view():
    # Latest push (after at +2h) is older than the view (+3h) → read.
    before = _Report(T0)
    after = _Report(T0 + timedelta(hours=2))
    assert _qa_reports_unread(before, after, T0 + timedelta(hours=3)) is False


# ── QA-report delegation: allocate / revoke / re-delegate ─────────────────────
# Mirrors the module allocation pattern — 409 only on an ACTIVE delegation, so a
# revoke leaves the (site, exec) re-delegatable, and the queue's delegate name is
# derived live from SiteDelegation (module='quality_audit'), never a stale column.

def _patch_site(monkeypatch, site):
    async def _fetch_site(session, *, site_id, tenant_id):
        return site
    monkeypatch.setattr(project_service, "fetch_site_for_update_or_404", _fetch_site)
    monkeypatch.setattr(project_service, "write_audit_event", _noop_audit)


async def test_supervisor_can_self_delegate_qa(monkeypatch):
    site = _site()
    _patch_site(monkeypatch, site)
    me = uuid.uuid4()
    session = RecordingSession([
        FakeResult(scalars_list=[]),                              # no reports uploaded yet
        FakeResult(scalar=_user(role="supervisor", user_id=me)),  # delegate lookup (self)
        FakeResult(scalar=None),                                   # no active delegation → allowed
    ])
    await project_service.svc_allocate_qa(
        session, tenant_id=TENANT, actor=_supervisor(me), site_id=site.id, delegate_user_id=me,
    )
    added = [o for o in session.added if isinstance(o, models.SiteDelegation)]
    assert len(added) == 1
    assert added[0].module == "quality_audit"
    assert str(added[0].delegate_user_id) == str(me)


async def test_qa_delegation_rejected_when_already_active(monkeypatch):
    # A duplicate ACTIVE delegation 409s — exactly what a revoke clears, which is
    # what makes re-delegation possible afterwards.
    site = _site()
    _patch_site(monkeypatch, site)
    ex = _user(role="executive")
    existing = models.SiteDelegation(
        id=uuid.uuid4(), tenant_id=TENANT, site_id=site.id, module="quality_audit",
        delegate_user_id=ex.id, granted_by=uuid.uuid4(),
    )
    session = RecordingSession([FakeResult(scalars_list=[]), FakeResult(scalar=ex), FakeResult(scalar=existing)])
    with pytest.raises(HTTPException) as exc:
        await project_service.svc_allocate_qa(
            session, tenant_id=TENANT, actor=_supervisor(), site_id=site.id, delegate_user_id=ex.id,
        )
    assert exc.value.status_code == 409


async def test_qa_redelegate_allowed_after_revoke(monkeypatch):
    # After a revoke there is NO active delegation, so the same (site, exec) can be
    # delegated again (the existing-check returns None → a fresh row is created).
    site = _site()
    _patch_site(monkeypatch, site)
    ex = _user(role="executive")
    session = RecordingSession([FakeResult(scalars_list=[]), FakeResult(scalar=ex), FakeResult(scalar=None)])
    await project_service.svc_allocate_qa(
        session, tenant_id=TENANT, actor=_supervisor(), site_id=site.id, delegate_user_id=ex.id,
    )
    added = [o for o in session.added if isinstance(o, models.SiteDelegation)]
    assert len(added) == 1 and added[0].module == "quality_audit"


async def test_qa_delegation_blocked_after_report_uploaded(monkeypatch):
    # Edge case: once a report is uploaded the task is in progress — delegating
    # 409s (the UI stays but surfaces this error rather than breaking).
    site = _site()
    _patch_site(monkeypatch, site)
    report = models.QualityAuditReport(
        id=uuid.uuid4(), tenant_id=TENANT, site_id=site.id, kind="before", file_key="k.pdf",
    )
    session = RecordingSession([FakeResult(scalars_list=[report])])  # a report already exists
    with pytest.raises(HTTPException) as exc:
        await project_service.svc_allocate_qa(
            session, tenant_id=TENANT, actor=_supervisor(), site_id=site.id, delegate_user_id=uuid.uuid4(),
        )
    assert exc.value.status_code == 409
    assert "already been uploaded" in exc.value.detail


async def test_qa_revoke_is_idempotent():
    out = await project_service.svc_revoke_qa_delegation(
        RecordingSession([FakeResult(scalar=None)]),
        tenant_id=TENANT, actor=_supervisor(), site_id=uuid.uuid4(), delegate_user_id=uuid.uuid4(),
    )
    assert "No active" in out.message


async def test_qa_delegation_requires_supervisor():
    with pytest.raises(HTTPException) as exc:
        await project_service.svc_allocate_qa(
            RecordingSession(), tenant_id=TENANT,
            actor={"sub": str(uuid.uuid4()), "role": "executive"},
            site_id=uuid.uuid4(), delegate_user_id=uuid.uuid4(),
        )
    assert exc.value.status_code == 403
