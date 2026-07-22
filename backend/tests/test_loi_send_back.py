"""LOI send-back: a supervisor can reject a wrongly-uploaded LOI.

The site returns to APPROVED rather than gaining a new status, so the executive
re-uploads through the unchanged APPROVED -> LOI_UPLOADED path. loi_uploaded_at
is cleared so the days-to-LOI clock resumes from approved_at — the LOI genuinely
is not done, and a retained timestamp would freeze the SLA bar while the row
reads "Awaiting LOI".

Also covers the two adjacent fixes: svc_view_loi no longer answers 200-with-null
when a stored file cannot be signed (that is what made "View LOI" look dead),
and svc_upload_loi now demotes the previous is_primary LOI row.
"""
from __future__ import annotations

import inspect
import pathlib
import re

import pytest
from fastapi import HTTPException

from app.db import models
from app.domain.state_machine import ALLOWED_TRANSITIONS, SiteStatus
from app.services import loi_service

TENANT = "22222222-2222-2222-2222-222222222222"
SITE_ID = "11111111-1111-1111-1111-111111111111"
ACTOR = {"sub": "33333333-3333-3333-3333-333333333333", "name": "Sup Ervisor",
         "role": "supervisor"}


def _site(status: str) -> models.Site:
    site = models.Site(tenant_id=TENANT, name="Test Site", code="TS-001")
    site.id = SITE_ID
    site.status = status
    site.loi_uploaded_at = "2026-07-01"
    site.loi_rejection_note = None
    site.assigned_to = None
    site.submitted_by = None
    return site


@pytest.fixture
def stub(monkeypatch):
    """Neutralise audit/notify IO and record what was asked for."""
    events: list[dict] = []
    audits: list[dict] = []

    async def _audit(_session, **kw):
        audits.append(kw)

    async def _notify(_session, **kw):
        events.append(kw)

    async def _owners(_session, **_kw):
        return ["owner-1"]

    monkeypatch.setattr(loi_service, "write_audit_event", _audit)
    monkeypatch.setattr(loi_service, "notify_enqueue", _notify)
    monkeypatch.setattr(loi_service, "recipients_for_site_owner", _owners)
    return {"events": events, "audits": audits}


# ── The reverse edge ──────────────────────────────────────────────────────────

def test_loi_uploaded_can_return_to_approved():
    assert SiteStatus.APPROVED in ALLOWED_TRANSITIONS[SiteStatus.LOI_UPLOADED]
    # The forward edge must survive — re-upload depends on it.
    assert SiteStatus.LOI_UPLOADED in ALLOWED_TRANSITIONS[SiteStatus.APPROVED]


def test_terminal_states_stay_terminal():
    """Adding one reverse edge must not have loosened the terminals."""
    for terminal in (SiteStatus.PUSHED_TO_PAYMENTS, SiteStatus.REJECTED, SiteStatus.ARCHIVED):
        assert ALLOWED_TRANSITIONS[terminal] == []


def test_frontend_state_machine_mirrors_the_backend():
    """state_machine.py claims to mirror frontend/src/lib/stateMachine.js exactly,
    but nothing enforced it. A half-mirrored map silently hides rows in the UI —
    the frontend runs assertTransition of its own."""
    js = (pathlib.Path(__file__).resolve().parents[2]
          / "frontend" / "src" / "lib" / "stateMachine.js").read_text()
    block = re.search(r"ALLOWED_TRANSITIONS\s*=\s*\{(.*?)\n\};", js, re.S)
    assert block, "could not locate ALLOWED_TRANSITIONS in stateMachine.js"

    js_map: dict[str, set[str]] = {}
    for line in block.group(1).splitlines():
        line = line.split("//")[0]
        m = re.search(r"\[SiteStatus\.([A-Z_]+)\]\s*:\s*\[(.*)", line)
        if m:
            current = m.group(1)
            js_map[current] = set(re.findall(r"SiteStatus\.([A-Z_]+)", m.group(2)))
        elif js_map:
            # continuation of a wrapped list
            found = re.findall(r"SiteStatus\.([A-Z_]+)", line)
            if found:
                js_map[current] |= set(found)

    py_map = {k.name: {v.name for v in vs} for k, vs in ALLOWED_TRANSITIONS.items()}
    assert js_map == py_map


# ── svc_send_back_loi ─────────────────────────────────────────────────────────

async def test_send_back_requires_comments(make_session, stub):
    sess = make_session()
    for blank in ("", "   ", None):
        with pytest.raises(HTTPException) as exc:
            await loi_service.svc_send_back_loi(
                sess, tenant_id=TENANT, actor=ACTOR, site_id=SITE_ID, comments=blank,
            )
        assert exc.value.status_code == 422
        assert "required" in exc.value.detail
    # Rejected before any DB work — the executive needs to be told what was wrong.
    assert sess.executed == []


async def test_send_back_returns_site_to_approved(make_session, fake_result, stub):
    site = _site(SiteStatus.LOI_UPLOADED.value)
    sess = make_session(fake_result(scalar=site))

    await loi_service.svc_send_back_loi(
        sess, tenant_id=TENANT, actor=ACTOR, site_id=SITE_ID, comments="  Wrong tenant named.  ",
    )

    assert site.status == SiteStatus.APPROVED.value
    assert site.loi_uploaded_at is None      # SLA clock resumes from approved_at
    assert site.loi_rejection_note == "Wrong tenant named."   # trimmed
    actions = [a["action"] for a in stub["audits"]]
    assert "send_back_loi" in actions
    assert [e["event"] for e in stub["events"]] == ["loi_sent_back"]


@pytest.mark.parametrize("status", [
    SiteStatus.LEGAL_REVIEW.value,      # already pushed to Legal
    SiteStatus.APPROVED.value,          # nothing uploaded to send back
    SiteStatus.PUSHED_TO_PAYMENTS.value,
])
async def test_send_back_rejects_wrong_status(make_session, fake_result, stub, status):
    sess = make_session(fake_result(scalar=_site(status)))
    with pytest.raises(HTTPException) as exc:
        await loi_service.svc_send_back_loi(
            sess, tenant_id=TENANT, actor=ACTOR, site_id=SITE_ID, comments="nope",
        )
    assert exc.value.status_code == 422
    assert stub["events"] == []


def test_send_back_holds_a_row_lock_and_audits_in_transaction():
    src = inspect.getsource(loi_service.svc_send_back_loi)
    assert "fetch_site_for_update_or_404" in src   # read-check-write needs the lock
    assert "assert_transition" in src              # guards double-click / race
    assert "write_audit_event" in src
    assert "notify_enqueue" in src
    assert "async with transaction(" in src
    # Every mutation and both side effects sit inside the transaction block.
    body = src.split("async with transaction(")[1]
    for needle in ("site.status =", "write_audit_event", "notify_enqueue"):
        assert needle in body


def test_send_back_params_are_keyword_only():
    params = list(inspect.signature(loi_service.svc_send_back_loi).parameters.values())
    assert params[0].name == "session"
    assert all(p.kind is inspect.Parameter.KEYWORD_ONLY for p in params[1:])


# ── svc_view_loi ──────────────────────────────────────────────────────────────

async def test_view_loi_503s_when_a_stored_file_cannot_be_signed(
    make_session, fake_result, monkeypatch,
):
    """The original "View LOI does nothing" symptom: a 200 carrying file_url=null
    is indistinguishable from success to a caller."""
    site = _site(SiteStatus.LOI_UPLOADED.value)
    file_row = models.SiteFile(
        tenant_id=TENANT, site_id=SITE_ID, file_type="loi", storage_path="loi/x/y/z.pdf",
    )
    file_row.uploaded_by = ACTOR["sub"]

    async def _no_url(_path, **_kw):
        return None

    monkeypatch.setattr(loi_service, "signed_url", _no_url)
    sess = make_session(fake_result(scalar=site), fake_result(scalar=file_row))

    with pytest.raises(HTTPException) as exc:
        await loi_service.svc_view_loi(sess, tenant_id=TENANT, site_id=SITE_ID)
    assert exc.value.status_code == 503


async def test_view_loi_returns_nulls_when_nothing_uploaded(make_session, fake_result):
    """No LOI row is a legitimate answer, not an error."""
    sess = make_session(
        fake_result(scalar=_site(SiteStatus.APPROVED.value)),
        fake_result(scalar=None),
    )
    resp = await loi_service.svc_view_loi(sess, tenant_id=TENANT, site_id=SITE_ID)
    assert resp.file_url is None and resp.uploaded_at is None


# ── svc_upload_loi housekeeping ───────────────────────────────────────────────

def test_upload_clears_the_note_and_supersedes_the_previous_primary():
    src = inspect.getsource(loi_service.svc_upload_loi)
    # A fresh upload answers the send-back.
    assert "site.loi_rejection_note = None" in src
    # Without the demote, every send-back cycle mints another is_primary row —
    # there is no unique constraint, and admin document lists show them all.
    assert "update(models.SiteFile)" in src
    assert "is_primary=False" in src
