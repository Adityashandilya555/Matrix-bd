"""Read-only module switching for the observer role.

Unlike tests/test_observer_readonly.py — which asserts the deny *decision* and
proves every mutating route reaches it — this file drives the real
``get_current_user`` end to end against the RecordingSession stand-in, because
the override branch is a genuine claim-rewrite and asserting it any other way
would just be re-implementing it in the test.

The thing under test is a grant, so most of these assert its edges: that the
override cannot reach ``real_role``, cannot name ``business_admin``, and cannot
survive a non-GET.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.core import deps
from app.core.security import issue_token
from app.rbac.roles import Role

from tests.conftest import FakeResult, RecordingSession

TENANT = "00000000-0000-0000-0000-0000000000aa"
USER = "00000000-0000-0000-0000-0000000000bb"


class _Req:
    """Only ``.method`` is read by get_current_user."""

    def __init__(self, method: str = "GET") -> None:
        self.method = method


def _token(role: str, module: str | None = None) -> str:
    return issue_token(
        sub=USER, email="asha@example.com", name="Asha",
        role=role, tenant_id=TENANT, city="Gurugram", module=module,
    )


def _session(*, role: str, has_exec: bool = False) -> RecordingSession:
    """A session whose one queued result is the is_active / role SELECT."""
    row = {
        "role": role,
        "is_active": True,
        "has_executive_access": has_exec,
        "has_pending_executive_request": False,
    }
    return RecordingSession(results=[FakeResult(mappings_rows=[row])])


async def _resolve(
    *, db_role: str, override_role: str | None = None,
    override_module: str | None = None, method: str = "GET",
    token_role: str | None = None,
) -> dict:
    return await deps.get_current_user(
        _Req(method),
        _session(role=db_role),
        authorization=f"Bearer {_token(token_role or db_role)}",
        x_override_role=override_role,
        x_override_module=override_module,
    )


# ── the grant ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_an_observer_may_enter_a_module_as_its_supervisor():
    claims = await _resolve(
        db_role="observer", override_role="supervisor", override_module="design",
    )
    assert claims["role"] == "supervisor"
    assert claims["module"] == "design"


@pytest.mark.asyncio
async def test_an_observer_may_enter_as_an_executive_too():
    claims = await _resolve(
        db_role="observer", override_role="executive", override_module="legal",
    )
    assert claims["role"] == "executive"


@pytest.mark.asyncio
async def test_the_module_claim_is_what_scopes_a_module_page():
    """An observer's own token carries no module, so without the header every
    module query would run against ``module = None`` and come back empty."""
    claims = await _resolve(db_role="observer", override_module="nso")
    assert claims["module"] == "nso"


@pytest.mark.asyncio
async def test_with_no_override_the_observer_is_still_plainly_an_observer():
    claims = await _resolve(db_role="observer")
    assert claims["role"] == "observer"
    assert claims["real_role"] == "observer"


# ── the edges ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_override_never_reaches_real_role():
    """The deny keys on real_role. If a header could rewrite it, the entire
    read-only boundary would be one request header away from gone."""
    claims = await _resolve(
        db_role="observer", override_role="supervisor", override_module="design",
    )
    assert claims["real_role"] == "observer"


@pytest.mark.asyncio
async def test_an_observer_cannot_present_as_a_business_admin():
    """services/_common.py's actor_is_business_admin() accepts `role` OR
    `real_role`, so admitting business_admin here would hand an observer an
    admin-tier identity on every read path that uses it."""
    claims = await _resolve(db_role="observer", override_role="business_admin")
    assert claims["role"] == "observer"


@pytest.mark.asyncio
async def test_an_unknown_override_role_is_ignored_rather_than_trusted():
    claims = await _resolve(db_role="observer", override_role="root")
    assert claims["role"] == "observer"


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["POST", "PATCH", "PUT", "DELETE"])
async def test_the_override_does_not_survive_a_write(method):
    """The point of the pairing: an observer viewing a module *as* a supervisor
    is still refused every mutating request."""
    with pytest.raises(HTTPException) as exc:
        await _resolve(
            db_role="observer", override_role="supervisor",
            override_module="design", method=method,
        )
    assert exc.value.status_code == 403
    assert "read-only" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_the_allowlist_excludes_business_admin_and_observer():
    assert deps._OBSERVER_OVERRIDE_ROLES == {
        Role.SUPERVISOR.value, Role.EXECUTIVE.value,
    }


# ── nothing else moved ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_business_admin_override_is_unchanged():
    """Still unrestricted — the admin branch runs before the observer one and
    must keep accepting any role string it always accepted."""
    claims = await _resolve(
        db_role="business_admin", override_role="business_admin",
        override_module="design",
    )
    assert claims["role"] == "business_admin"
    assert claims["module"] == "design"


@pytest.mark.asyncio
async def test_a_plain_supervisor_still_cannot_override_anything():
    claims = await _resolve(
        db_role="supervisor", override_role="business_admin",
        override_module="legal", token_role="supervisor",
    )
    assert claims["role"] == "supervisor"
    assert claims["module"] is None


@pytest.mark.asyncio
async def test_the_read_only_transaction_is_still_released():
    """The #103 ordering: the is_active SELECT autobegins, and get_current_user
    must roll it back before returning or every later write lands in a savepoint
    that is never committed."""
    db = _session(role="observer")
    await deps.get_current_user(
        _Req("GET"), db,
        authorization=f"Bearer {_token('observer')}",
        x_override_role="supervisor", x_override_module="design",
    )
    assert db.rollback_count == 1
