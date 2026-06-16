"""Security regression tests — issues #80, #83, #84, #85, #103, #109, #110, #111.

Each test FAILS on the pre-fix code and PASSES after:

* #80  — default JWT secret / platform-admin password must refuse to boot
  outside an explicit insecure-dev mode.
* #83  — NULL-password active accounts were fully loginable (and the first
  password anyone submitted was silently stored — account claim).
* #84  — workspace_code carried only 16 bits of entropy and /auth/login +
  /tenancy/branding were valid-code oracles (404 vs 2xx).
* #85  — password-reset completion was not bound to the requester: an
  approved row + (email, workspace_code) overwrote the password. Now requires
  the single-use token issued at admin approval.
* #103 — 24h JWTs baked role/is_active with no per-request recheck: a
  deactivated user kept full access for a day.
* #109 — zero rate limiting on the unauthenticated endpoints.
* #110 — CORS: wildcard-with-credentials must be rejected; the localhost
  regex must not be force-allowed in production.
* #111 — Swagger/OpenAPI must be off unless explicitly enabled.
"""
from __future__ import annotations

import hashlib
import uuid

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.core.config import Settings


TENANT_ROW = {"id": uuid.uuid4(), "name": "Acme", "seat_limit": 10}
USER_ID = uuid.uuid4()


def _user_row(password_hash=None, is_active=True, role="executive"):
    return {
        "id": USER_ID, "email": "a@b.co", "name": "A", "role": role,
        "is_active": is_active, "assigned_city": None, "password_hash": password_hash,
    }


def _settings(**kw):
    base = dict(
        _env_file=None,
        supabase_jwt_secret="a-real-secret-of-decent-length-12345",
        allow_insecure_defaults=False,
    )
    base.update(kw)
    return Settings(**base)


# ── #80 — fail fast on repo-committed default secrets ──────────────────────

def test_default_jwt_secret_refuses_to_boot():
    with pytest.raises((RuntimeError, ValidationError)):
        _settings(supabase_jwt_secret="change-me-in-production")


def test_retired_admin_password_is_treated_as_disabled():
    # Fail-safe (not a boot brick): the retired public default is honored as
    # "unset", so the admin portal is disabled rather than accepting it.
    s = _settings(platform_admin_password="BlueTokai-Matrix-2026")
    assert s.effective_platform_admin_password == ""
    assert s.effective_platform_admin_token == ""


def test_insecure_dev_mode_allows_defaults():
    s = _settings(
        supabase_jwt_secret="change-me-in-production",
        allow_insecure_defaults=True,
    )
    assert s.allow_insecure_defaults is True


# ── #224 — ALLOW_ANON_DEMO_USER must be gated by insecure-dev mode ─────────
# The demo bypass (deps.py) authenticates a header-less request as an
# executive on tenant …099. Its only safety control used to be "operator
# remembers to keep the env var false" — nothing bound it to insecure-dev
# mode the way the JWT-secret placeholder is. These pin the gate.

def test_demo_user_flag_refuses_to_boot_outside_insecure_dev():
    # PROVE-FIRST: pre-fix this construction did NOT raise (the gap).
    with pytest.raises((RuntimeError, ValidationError)):
        _settings(allow_anon_demo_user=True, allow_insecure_defaults=False)


def test_demo_user_flag_allowed_in_insecure_dev():
    # Local UI-driving runs with ALLOW_INSECURE_DEFAULTS=true (placeholder
    # secret), so the demo user must keep working there.
    s = _settings(
        supabase_jwt_secret="change-me-in-production",
        allow_insecure_defaults=True,
        allow_anon_demo_user=True,
    )
    assert s.allow_anon_demo_user is True


def test_demo_user_flag_false_is_unaffected():
    # Prod default: flag off boots cleanly with any valid secret.
    s = _settings(allow_anon_demo_user=False)
    assert s.allow_anon_demo_user is False


# ── #83 — no passwordless fall-through, no silent first-password claim ─────

async def test_login_rejects_null_hash_account_without_password(make_session, fake_result):
    from app.routers.auth import LoginIn, login

    sess = make_session(
        fake_result(mappings_rows=[TENANT_ROW]),
        fake_result(mappings_rows=[_user_row(password_hash=None)]),
    )
    payload = LoginIn(email="a@b.co", workspace_code="ACME-CODE1")
    with pytest.raises(HTTPException) as exc:
        await login(payload, sess)
    assert exc.value.status_code == 401


async def test_login_does_not_silently_store_first_password(make_session, fake_result):
    """Pre-fix, submitting any password against a NULL-hash account stored it
    (account claim). Now it must be rejected with no UPDATE."""
    from app.routers.auth import LoginIn, login

    sess = make_session(
        fake_result(mappings_rows=[TENANT_ROW]),
        fake_result(mappings_rows=[_user_row(password_hash=None)]),
    )
    payload = LoginIn(email="a@b.co", workspace_code="ACME-CODE1", password="attacker-pw")
    with pytest.raises(HTTPException) as exc:
        await login(payload, sess)
    assert exc.value.status_code == 401
    assert not any("UPDATE users" in s for s in sess.executed)


# ── #84 — workspace code entropy + oracle removal ───────────────────────────

def test_workspace_code_suffix_has_at_least_64_bits():
    from app.routers.tenancy import _generate_workspace_code

    code = _generate_workspace_code("Blue Tokai")
    suffix = code.split("-", 1)[1]
    assert len(suffix) >= 16  # 16 hex chars = 64 bits (was 4 = 16 bits)


async def test_login_unknown_code_is_not_an_oracle(make_session, fake_result):
    """Unknown workspace code must return the same soft 202 'pending' shape a
    valid-code unknown-email gets — not a distinguishing 404."""
    from app.routers.auth import LoginIn, login

    sess = make_session(fake_result(mappings_rows=[]))
    out = await login(LoginIn(email="a@b.co", workspace_code="NOPE-0000"), sess)
    assert out.status_code == 202


async def test_branding_unknown_code_is_not_an_oracle(make_session, fake_result):
    from app.routers.tenancy import public_branding

    sess = make_session(fake_result(mappings_rows=[]))
    out = await public_branding("NOPE-0000", sess)
    assert out == {"name": None, "logo_url": None}


# ── #85 — reset completion bound to a single-use token ─────────────────────

def test_reset_complete_schema_requires_token():
    from app.routers.auth import ResetCompleteIn

    with pytest.raises(ValidationError):
        ResetCompleteIn(email="a@b.co", workspace_code="ACME-1234", new_password="hunter22")


async def test_reset_complete_rejects_wrong_token(make_session, fake_result):
    from app.routers.auth import ResetCompleteIn, password_reset_complete

    right = "the-right-token"
    sess = make_session(
        fake_result(mappings_rows=[TENANT_ROW]),
        fake_result(mappings_rows=[{"id": USER_ID}]),
        fake_result(mappings_rows=[{
            "id": uuid.uuid4(),
            "reset_token_hash": hashlib.sha256(right.encode()).hexdigest(),
        }]),
    )
    payload = ResetCompleteIn(
        email="a@b.co", workspace_code="ACME-1234",
        new_password="hunter22", reset_token="the-wrong-token",
    )
    with pytest.raises(HTTPException) as exc:
        await password_reset_complete(payload, sess)
    assert exc.value.status_code == 403
    assert not any("UPDATE users" in s for s in sess.executed)


async def test_reset_complete_accepts_matching_token(make_session, fake_result):
    from app.routers.auth import ResetCompleteIn, password_reset_complete

    token = "the-right-token"
    sess = make_session(
        fake_result(mappings_rows=[TENANT_ROW]),
        fake_result(mappings_rows=[{"id": USER_ID}]),
        fake_result(mappings_rows=[{
            "id": uuid.uuid4(),
            "reset_token_hash": hashlib.sha256(token.encode()).hexdigest(),
        }]),
    )
    payload = ResetCompleteIn(
        email="a@b.co", workspace_code="ACME-1234",
        new_password="hunter22", reset_token=token,
    )
    out = await password_reset_complete(payload, sess)
    assert out["status"] == "reset"
    assert any("UPDATE users" in s for s in sess.executed)


async def test_reset_confirm_issues_token_and_stores_hash(make_session, fake_result, monkeypatch):
    from app.core.config import settings as live_settings
    from app.routers.tenancy import confirm_password_reset_request

    # _require_platform_admin compares against effective_platform_admin_token,
    # which is `platform_admin_token or effective_platform_admin_password`. Pin
    # the TOKEN (not just the password) or this test 401s on any machine whose
    # .env sets a real PLATFORM_ADMIN_TOKEN — the token would otherwise win and
    # the patched password be ignored.
    monkeypatch.setattr(live_settings, "platform_admin_token", "k")
    monkeypatch.setattr(live_settings, "platform_admin_password", "k")
    sess = make_session(
        fake_result(mappings_rows=[{"id": uuid.uuid4(), "status": "pending", "user_id": USER_ID}]),
    )
    out = await confirm_password_reset_request(
        "rid", sess, x_platform_admin_key="k",
    )
    assert out.get("reset_token")  # plaintext token returned ONCE to the admin
    update_sql = next(s for s in sess.executed if "UPDATE password_reset_requests" in s)
    assert "reset_token_hash" in update_sql


# ── #103 — per-request is_active / role recheck ─────────────────────────────

async def test_deactivated_user_token_is_rejected(make_session, fake_result):
    from app.core.deps import get_current_user
    from app.core.security import issue_token

    token = issue_token(
        sub=str(USER_ID), email="a@b.co", name="A",
        role="executive", tenant_id=str(uuid.uuid4()),
    )
    sess = make_session(
        fake_result(mappings_rows=[{"role": "executive", "is_active": False}]),
    )
    with pytest.raises(HTTPException) as exc:
        await get_current_user(authorization=f"Bearer {token}", db=sess)
    assert exc.value.status_code == 401


async def test_demoted_user_gets_db_role_not_stale_claim(make_session, fake_result):
    from app.core.deps import get_current_user
    from app.core.security import issue_token

    token = issue_token(
        sub=str(USER_ID), email="a@b.co", name="A",
        role="supervisor", tenant_id=str(uuid.uuid4()),
    )
    sess = make_session(
        fake_result(mappings_rows=[{"role": "executive", "is_active": True}]),
    )
    user = await get_current_user(authorization=f"Bearer {token}", db=sess)
    assert user["role"] == "executive"  # DB wins over the stale claim


# ── #109 — rate limiting primitive on public endpoints ─────────────────────

class _FakeClient:
    host = "203.0.113.7"


class _FakeRequest:
    client = _FakeClient()
    headers: dict = {}
    scope = {"path": "/api/auth/login"}


async def test_rate_limit_dependency_throttles():
    from app.core.ratelimit import rate_limit

    guard = rate_limit(times=2, seconds=3600)
    req = _FakeRequest()
    await guard(req)
    await guard(req)
    with pytest.raises(HTTPException) as exc:
        await guard(req)
    assert exc.value.status_code == 429


def test_login_route_declares_rate_limit():
    import inspect

    import app.routers.auth as auth_mod

    src = inspect.getsource(auth_mod)
    assert "rate_limit(" in src


# ── #110 — CORS hardening ───────────────────────────────────────────────────

def test_wildcard_cors_origin_is_stripped_not_fatal():
    # Fail-safe: the dangerous wildcard is dropped (so the API still boots),
    # leaving only exact origins.
    s = _settings(cors_origins="*,https://app.example.com")
    assert "*" not in s.cors_origin_list
    assert s.cors_origin_list == ["https://app.example.com"]


def test_localhost_regex_not_applied_unless_opted_in():
    s = _settings()
    assert (s.effective_cors_origin_regex or "") == ""
    dev = _settings(cors_allow_localhost=True)
    assert "localhost" in dev.effective_cors_origin_regex


# ── #111 — docs off by default ──────────────────────────────────────────────

def test_swagger_and_openapi_disabled_by_default(monkeypatch):
    monkeypatch.delenv("ENABLE_DOCS", raising=False)
    s = _settings()
    assert s.enable_docs is False


def test_app_does_not_publish_docs_by_default():
    from app.main import app

    assert app.docs_url is None
    assert app.openapi_url is None


# ── Onboarding: account_state + self-service first password + no ghost users ──
# Fixes the post-approval deadstate (an approved supervisor/executive sets their
# own first password) and the wrong "reset" prompt for non-member emails.

async def test_login_unknown_email_in_known_workspace_is_404(make_session, fake_result):
    """A valid workspace_code + an email that isn't a member must NOT be
    auto-registered as a pending ghost user — it returns a clear 404 and writes
    nothing."""
    from app.routers.auth import LoginIn, login

    sess = make_session(
        fake_result(mappings_rows=[TENANT_ROW]),
        fake_result(mappings_rows=[]),  # no such user in this tenant
    )
    payload = LoginIn(email="stranger@b.co", workspace_code="ACME-CODE1")
    with pytest.raises(HTTPException) as exc:
        await login(payload, sess)
    assert exc.value.status_code == 404
    assert not any("INSERT INTO users" in s for s in sess.executed)


async def test_login_check_reports_account_state(make_session, fake_result):
    from app.routers.auth import LoginCheckIn, login_check

    async def _state(*results):
        out = await login_check(
            LoginCheckIn(email="a@b.co", workspace_code="ACME-CODE1"),
            make_session(*results),
        )
        return out

    # unknown workspace → unknown (workspace_code stays a non-oracle)
    assert (await _state(fake_result(mappings_rows=[])))["account_state"] == "unknown"
    # known workspace, unknown email → unknown
    assert (await _state(
        fake_result(mappings_rows=[TENANT_ROW]),
        fake_result(mappings_rows=[]),
    ))["account_state"] == "unknown"
    # approval not granted yet → pending
    assert (await _state(
        fake_result(mappings_rows=[TENANT_ROW]),
        fake_result(mappings_rows=[{"is_active": False, "password_hash": None}]),
    ))["account_state"] == "pending"
    # approved, no password → self-service setup
    assert (await _state(
        fake_result(mappings_rows=[TENANT_ROW]),
        fake_result(mappings_rows=[{"is_active": True, "password_hash": None}]),
    ))["account_state"] == "needs_password"
    # has a password → active (+ legacy flag stays true)
    active = await _state(
        fake_result(mappings_rows=[TENANT_ROW]),
        fake_result(mappings_rows=[{"is_active": True, "password_hash": "bcrypt$"}]),
    )
    assert active["account_state"] == "active"
    assert active["password_set"] is True


async def test_password_setup_sets_first_password(make_session, fake_result):
    from app.routers.auth import PasswordSetupIn, password_setup

    sess = make_session(
        fake_result(mappings_rows=[TENANT_ROW]),
        fake_result(mappings_rows=[{"id": USER_ID, "is_active": True, "password_hash": None}]),
        fake_result(rowcount=1),  # guarded UPDATE changed the row
    )
    out = await password_setup(
        PasswordSetupIn(email="a@b.co", workspace_code="ACME-CODE1", new_password="hunter22"),
        sess,
    )
    assert out["status"] == "set"
    assert any("UPDATE users" in s for s in sess.executed)
    assert sess.commit_count == 1


async def test_password_setup_conflicts_when_password_exists(make_session, fake_result):
    from app.routers.auth import PasswordSetupIn, password_setup

    sess = make_session(
        fake_result(mappings_rows=[TENANT_ROW]),
        fake_result(mappings_rows=[{"id": USER_ID, "is_active": True, "password_hash": "already"}]),
    )
    with pytest.raises(HTTPException) as exc:
        await password_setup(
            PasswordSetupIn(email="a@b.co", workspace_code="ACME-CODE1", new_password="hunter22"),
            sess,
        )
    assert exc.value.status_code == 409
    assert not any("UPDATE users" in s for s in sess.executed)


async def test_password_setup_race_lost_does_not_overwrite(make_session, fake_result):
    """SELECT saw NULL, but a concurrent setup set the password first — the
    guarded UPDATE affects 0 rows, so we 409 and roll back rather than overwrite
    (the #83 claim race stays closed)."""
    from app.routers.auth import PasswordSetupIn, password_setup

    sess = make_session(
        fake_result(mappings_rows=[TENANT_ROW]),
        fake_result(mappings_rows=[{"id": USER_ID, "is_active": True, "password_hash": None}]),
        fake_result(rowcount=0),  # lost the race
    )
    with pytest.raises(HTTPException) as exc:
        await password_setup(
            PasswordSetupIn(email="a@b.co", workspace_code="ACME-CODE1", new_password="hunter22"),
            sess,
        )
    assert exc.value.status_code == 409
    assert sess.rollback_count == 1
    assert sess.commit_count == 0


async def test_password_setup_rejects_pending_account(make_session, fake_result):
    from app.routers.auth import PasswordSetupIn, password_setup

    sess = make_session(
        fake_result(mappings_rows=[TENANT_ROW]),
        fake_result(mappings_rows=[{"id": USER_ID, "is_active": False, "password_hash": None}]),
    )
    with pytest.raises(HTTPException) as exc:
        await password_setup(
            PasswordSetupIn(email="a@b.co", workspace_code="ACME-CODE1", new_password="hunter22"),
            sess,
        )
    assert exc.value.status_code == 403
    assert not any("UPDATE users" in s for s in sess.executed)


async def test_password_setup_unknown_email_is_404(make_session, fake_result):
    from app.routers.auth import PasswordSetupIn, password_setup

    sess = make_session(
        fake_result(mappings_rows=[TENANT_ROW]),
        fake_result(mappings_rows=[]),
    )
    with pytest.raises(HTTPException) as exc:
        await password_setup(
            PasswordSetupIn(email="a@b.co", workspace_code="ACME-CODE1", new_password="hunter22"),
            sess,
        )
    assert exc.value.status_code == 404
