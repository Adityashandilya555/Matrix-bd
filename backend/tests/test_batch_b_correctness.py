"""Batch B — backend input / correctness.

Covers:
  #135 expected_escalation_years bound (smallint overflow -> 422 not 500)
  #123 membership inserts: pending-state guard + ON CONFLICT idempotency
  #124 login module claim ordered deterministically (no arbitrary LIMIT 1)
  #121 assign-role clears notes + provisions the module membership row

(#141 is validated in test_batch_a_observability.py alongside launch_service.)
"""
from __future__ import annotations

import inspect

import pytest
from pydantic import ValidationError

from app.domain.schemas.site import CreateDraftRequest
from app.routers import users as users_router
from app.services import business_admin_service, supervisor_code_service


# ── #135 — escalation-years bound ──────────────────────────────────────────

def _draft(**kw):
    base = {"name": "A", "city": "Mumbai", "visit_date": "2026-06-01"}
    base.update(kw)
    return CreateDraftRequest(**base)


def test_escalation_years_accepts_valid():
    assert _draft(expected_escalation_years=5).expected_escalation_years == 5


def test_escalation_years_allows_none():
    assert _draft().expected_escalation_years is None


def test_escalation_years_rejects_smallint_overflow():
    # 40000 > int2 max (32767) — used to reach asyncpg and 500.
    with pytest.raises(ValidationError):
        _draft(expected_escalation_years=40000)


def test_escalation_years_rejects_negative():
    with pytest.raises(ValidationError):
        _draft(expected_escalation_years=-1)


# ── #123 — membership idempotency + pending guard ──────────────────────────

async def test_approve_supervisor_inserts_with_on_conflict(make_session, fake_result):
    sess = make_session(fake_result(mappings_rows=[{"is_active": False}]))
    await business_admin_service.approve_supervisor(
        sess, tenant_id="t", user_id="u", module="design",
    )
    assert "ON CONFLICT (user_id, module)" in sess.sql
    assert "UPDATE users" in sess.sql


async def test_approve_supervisor_noop_when_already_active(make_session, fake_result):
    sess = make_session(fake_result(mappings_rows=[{"is_active": True}]))
    await business_admin_service.approve_supervisor(
        sess, tenant_id="t", user_id="u", module="design",
    )
    # Idempotent: no activation, no membership insert on a double-click.
    assert "INSERT INTO user_module_memberships" not in sess.sql
    assert "UPDATE users" not in sess.sql


async def test_approve_exec_inserts_with_on_conflict(make_session, fake_result):
    sess = make_session(fake_result(mappings_rows=[{"is_active": False}]))
    await supervisor_code_service.approve_my_pending_exec(
        sess, tenant_id="t", supervisor_id="s", user_id="u", module="legal",
    )
    assert "ON CONFLICT (user_id, module)" in sess.sql


async def test_approve_exec_noop_when_already_active(make_session, fake_result):
    sess = make_session(fake_result(mappings_rows=[{"is_active": True}]))
    await supervisor_code_service.approve_my_pending_exec(
        sess, tenant_id="t", supervisor_id="s", user_id="u", module="legal",
    )
    assert "INSERT INTO user_module_memberships" not in sess.sql


# ── #124 — deterministic module claim at login ─────────────────────────────

def test_login_membership_query_is_ordered():
    import app.routers.auth as auth_mod

    src = inspect.getsource(auth_mod)
    anchor = "SELECT module, role_in_module, supervisor_id"
    assert anchor in src
    snippet = src[src.index(anchor): src.index(anchor) + 280]
    assert "ORDER BY module" in snippet
    assert snippet.index("ORDER BY") < snippet.index("LIMIT")


# ── #121 — assign-role provisions membership + clears notes ─────────────────

def test_membership_from_notes_supervisor_marker():
    assert users_router._membership_from_notes("pending_module:design") == (
        "design", "supervisor", None,
    )


def test_membership_from_notes_exec_marker():
    assert users_router._membership_from_notes(
        "pending_supervisor:abc-123|module:legal",
    ) == ("legal", "executive", "abc-123")


def test_membership_from_notes_generic_is_none():
    assert users_router._membership_from_notes(None) is None
    assert users_router._membership_from_notes("") is None
    assert users_router._membership_from_notes("just a note") is None


async def test_assign_role_provisions_membership_and_clears_notes(make_session, fake_result, monkeypatch):
    async def _no_audit(*a, **k):
        return None

    monkeypatch.setattr(users_router, "write_audit_event", _no_audit)
    uid = "11111111-1111-1111-1111-111111111111"
    sess = make_session(fake_result(mappings_rows=[{
        "id": uid, "email": "x@y.com", "name": "X", "role": "executive",
        "is_active": False, "notes": "pending_module:design",
    }]))
    body = users_router.AssignRoleRequest(role="executive", city="Mumbai")

    out = await users_router.assign_role(
        user_id=uid, body=body, db=sess,
        current_user={"sub": "actor", "name": "Boss"}, tenant_id="t",
    )

    assert "user_module_memberships" in sess.sql
    assert "ON CONFLICT (user_id, module)" in sess.sql
    assert "notes" in sess.sql and "NULL" in sess.sql  # notes cleared in UPDATE
    assert sess.commit_count >= 1
    assert out.role == "executive"
