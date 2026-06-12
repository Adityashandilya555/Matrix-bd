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


def test_default_admin_password_refuses_to_boot():
    with pytest.raises((RuntimeError, ValidationError)):
        _settings(platform_admin_password="BlueTokai-Matrix-2026")


def test_insecure_dev_mode_allows_defaults():
    s = _settings(
        supabase_jwt_secret="change-me-in-production",
        allow_insecure_defaults=True,
    )
    assert s.allow_insecure_defaults is True


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

def test_wildcard_cors_origin_is_rejected():
    with pytest.raises((RuntimeError, ValidationError)):
        _settings(cors_origins="*")


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
