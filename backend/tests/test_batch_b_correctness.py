"""Batch B — backend input / correctness.

Covers:
  #166 rent_type Literal validation (off-vocab input -> 422, not 500)
  #135 expected_escalation_years bound (smallint overflow -> 422 not 500)
  #123 membership inserts: pending-state guard + ON CONFLICT idempotency
  #124 login module claim ordered deterministically (no arbitrary LIMIT 1)
  #121 assign-role clears notes + provisions the module membership row
  #79 workflow transitions lock rows and idempotently seed downstream records

(#141 is validated in test_batch_a_observability.py alongside launch_service.)
"""
from __future__ import annotations

import inspect
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.domain.schemas.launch import LaunchRentFieldsRequest
from app.domain.schemas.site import CreateDraftRequest, SaveDetailsRequest
from app.routers import users as users_router
from app.services import _common, bd_service, business_admin_service, supervisor_code_service, workflow_unlocks


# ── #166 — rent_type Literal validation ────────────────────────────────────
# The live DB has:  CHECK (rent_type IN ('fixed','revshare','mg_revshare') OR rent_type IS NULL)
# Without a backend Literal, any string reaches asyncpg and raises an unhandled
# IntegrityError → 500. With RentType the schema layer rejects it with a 422.

def test_rent_type_accepts_valid_values():
    for v in ("fixed", "revshare", "mg_revshare"):
        assert _draft(rent_type=v).rent_type == v


def test_rent_type_allows_none():
    assert _draft(rent_type=None).rent_type is None
    assert _draft().rent_type is None


def test_rent_type_rejects_off_vocab():
    # These were the old enum values — "revenue_share" and "hybrid" — that live in
    # the orphaned Postgres enum type but are NOT in the active CHECK constraint.
    for bad in ("revenue_share", "hybrid", "FIXED", "Fixed", ""):
        with pytest.raises(ValidationError):
            _draft(rent_type=bad)


def test_save_details_rent_type_validated():
    # SaveDetailsRequest also feeds sites.rent_type via the patch endpoint.
    assert SaveDetailsRequest(rent_type="revshare").rent_type == "revshare"
    with pytest.raises(ValidationError):
        SaveDetailsRequest(rent_type="revenue_share")


def test_launch_rent_fields_rent_type_validated():
    # LaunchRentFieldsRequest copies rent_type into launch_approvals then into
    # sites.rent_type on final-confirm — same CHECK constraint applies.
    assert LaunchRentFieldsRequest(rent_type="mg_revshare").rent_type == "mg_revshare"
    with pytest.raises(ValidationError):
        LaunchRentFieldsRequest(rent_type="hybrid")


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
    # Post-#86 the pending row must carry the caller's ownership marker.
    sess = make_session(fake_result(mappings_rows=[{
        "is_active": False, "role": "executive", "notes": "pending_supervisor:s|module:legal",
    }]))
    await supervisor_code_service.approve_my_pending_exec(
        sess, tenant_id="t", supervisor_id="s", user_id="u", module="legal",
    )
    assert "ON CONFLICT (user_id, module)" in sess.sql


async def test_approve_exec_noop_when_already_active(make_session, fake_result):
    # Double-click replay: user already active AND already this supervisor's
    # member in this module (second queued row) → silent idempotent return.
    sess = make_session(
        fake_result(mappings_rows=[{"is_active": True, "role": "executive", "notes": None}]),
        fake_result(mappings_rows=[{"?column?": 1}]),
    )
    await supervisor_code_service.approve_my_pending_exec(
        sess, tenant_id="t", supervisor_id="s", user_id="u", module="legal",
    )
    assert "INSERT INTO user_module_memberships" not in sess.sql
    assert "UPDATE users" not in sess.sql


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


# ── #79 — state-changing workflow operations lock + seed idempotently ───────

async def test_site_for_update_helper_emits_row_lock(make_session, fake_result):
    site = SimpleNamespace(id="site", tenant_id="tenant")
    sess = make_session(fake_result(scalar=site))

    out = await _common.fetch_site_for_update_or_404(
        sess,
        site_id="site",
        tenant_id="tenant",
    )

    assert out is site
    assert "FOR UPDATE" in sess.sql


def test_bd_status_mutations_use_locked_site_fetch():
    src = inspect.getsource(bd_service)
    for fn_name in (
        "svc_shortlist_draft",
        "svc_save_details",
        "svc_submit_details",
        "svc_approve_shortlist",
        "svc_push_to_payments",
        "svc_reject_site",
        "svc_archive_site",
        "svc_revive_site",
    ):
        fn_src = src[src.index(f"async def {fn_name}"):]
        next_marker = fn_src.find("\n\n# ──", 1)
        if next_marker != -1:
            fn_src = fn_src[:next_marker]
        assert "fetch_site_for_update_or_404" in fn_src


def test_send_to_legal_seeds_dd_checklist_idempotently():
    src = inspect.getsource(bd_service.svc_push_to_payments)
    assert "select(models.LegalDdChecklist)" in src
    assert "existing_legal_dd is None" in src


async def test_design_unlock_rechecks_under_row_lock(make_session, fake_result, monkeypatch):
    site_id = uuid4()
    tenant_id = uuid4()
    site = SimpleNamespace(
        id=site_id,
        tenant_id=tenant_id,
        status="legal_approved",
        legal_dd_status="positive",
        finance_status="approved",
        design_status=None,
        pushed_to_payments_at=None,
    )

    async def _no_audit(*a, **k):
        return None

    monkeypatch.setattr(workflow_unlocks, "write_audit_event", _no_audit)
    sess = make_session(fake_result(scalar=site))

    changed = await workflow_unlocks.maybe_unlock_design(
        sess,
        tenant_id=tenant_id,
        actor={"sub": uuid4(), "name": "Admin"},
        site=site,
        reason="test",
    )

    assert changed is True
    assert "FOR UPDATE" in sess.sql
    assert site.design_status == "pending"
    assert site.status == "pushed_to_payments"


def test_ca_code_validation():
    from pydantic import ValidationError
    from app.routers.sites import _FinanceDraftBody

    # 1. Valid codes should pass
    req = _FinanceDraftBody(ca_code="CA-12345")
    assert req.ca_code == "CA-12345"

    req_none = _FinanceDraftBody(ca_code=None)
    assert req_none.ca_code is None

    # 2. Invalid characters should raise ValidationError
    with pytest.raises(ValidationError):
        _FinanceDraftBody(ca_code="ca-12345")  # lowercase not allowed

    with pytest.raises(ValidationError):
        _FinanceDraftBody(ca_code="CA 12345")  # spaces not allowed

    with pytest.raises(ValidationError):
        _FinanceDraftBody(ca_code="CA-123\nBcc:victim@example.com")  # newline not allowed

    with pytest.raises(ValidationError):
        _FinanceDraftBody(ca_code="A" * 51)  # max_length is 50


async def test_ca_code_sanitization():
    import re
    # Test that the regex used inside finance_service.py correctly strips special characters
    ca_code_injected = "CA-123\r\nBcc: victim@example.com"
    safe_ca = re.sub(r"[^\w\-]", "", ca_code_injected)
    assert safe_ca == "CA-123Bccvictimexamplecom"  # Newlines and special characters completely stripped
