"""The `observer` role: reads everything, writes nothing.

The role is two grants and one deny, and the tests below exist because the grants
are deliberately wide:

  * app/rbac/guards.py — an observer satisfies every require_role and
    require_module, exactly as business_admin does. Without it, 85 GET routes
    carry a role or module dependency and the role could see almost nothing.
  * app/core/deps.py   — every non-GET request from an observer is refused at
    get_current_user.

So the deny is the ONLY thing standing between observer and full write access.
The enumeration test at the bottom is what keeps that true: the existing suite
calls handler coroutines directly and bypasses Depends() entirely, so removing a
role guard from a route would otherwise break nothing.
"""
from __future__ import annotations

import inspect

import pytest
from fastapi import HTTPException

from app.core import deps
from app.rbac.guards import require_module, require_role
from app.rbac.roles import READ_ALL_ROLES, Role


# ── the role itself ───────────────────────────────────────────────────────────

def test_observer_is_a_role():
    assert Role.OBSERVER.value == "observer"


def test_read_all_roles_is_exactly_admin_and_observer():
    """One constant feeds both guards so they cannot drift apart.

    A role admitted by require_role but not require_module would pass every
    non-module route and 403 only on module ones — a confusing shape of bug.
    """
    assert READ_ALL_ROLES == frozenset({"business_admin", "observer"})


def test_guards_share_the_constant_rather_than_hardcoding_roles():
    """Both bypasses must read READ_ALL_ROLES, not a string literal."""
    for fn in (require_role, require_module):
        src = inspect.getsource(fn)
        assert "READ_ALL_ROLES" in src, f"{fn.__name__} no longer uses the shared constant"
        assert '!= "business_admin"' not in src, f"{fn.__name__} reintroduced a literal check"


# ── the grants: an observer can read ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_observer_satisfies_require_role():
    """Without this the role is useless — it would 403 on most GET routes."""
    guard = require_role(Role.SUPERVISOR)
    actor = {"role": "observer", "real_role": "observer"}
    assert await guard(current_user=actor) is actor


@pytest.mark.asyncio
async def test_observer_satisfies_require_module_despite_having_none():
    """An observer is workspace-wide and holds no module membership, so a module
    comparison is meaningless for it."""
    guard = require_module("design")
    actor = {"role": "observer", "real_role": "observer", "module": None}
    assert await guard(current_user=actor) is actor


@pytest.mark.asyncio
async def test_executive_is_still_refused():
    """The bypass must not have widened to everyone."""
    guard = require_role(Role.SUPERVISOR)
    with pytest.raises(HTTPException) as exc:
        await guard(current_user={"role": "executive", "real_role": "executive"})
    assert exc.value.status_code == 403


# ── the deny: an observer cannot write ────────────────────────────────────────

class _Req:
    def __init__(self, method):
        self.method = method


def _deny_applies(real_role: str, method: str) -> bool:
    """Mirror of the check in get_current_user, over its two real inputs.

    get_current_user cannot be called directly here — it needs a live DB session
    — so this asserts the decision itself. The enumeration test below is what
    proves the decision is actually reached by every mutating route.
    """
    return real_role == Role.OBSERVER.value and method not in deps._READ_METHODS


@pytest.mark.parametrize("method", ["POST", "PATCH", "PUT", "DELETE"])
def test_observer_is_denied_every_mutating_method(method):
    assert _deny_applies("observer", method)


@pytest.mark.parametrize("method", ["GET", "HEAD", "OPTIONS"])
def test_observer_may_read(method):
    """OPTIONS matters: refusing preflight would break the browser client."""
    assert not _deny_applies("observer", method)


@pytest.mark.parametrize("role", ["business_admin", "supervisor", "executive"])
def test_no_other_role_is_affected(role):
    assert not _deny_applies(role, "POST")


def test_the_deny_keys_on_real_role_not_role():
    """The whole point: X-Override-Role rewrites `role`, never `real_role`.

    An observer viewing a module "as supervisor" would otherwise lift its own
    restriction by setting a header.
    """
    src = inspect.getsource(deps.get_current_user)
    idx = src.index("Observer access is read-only")
    window = src[max(0, idx - 700):idx]
    assert 'claims.get("real_role")' in window
    assert 'claims.get("role") == Role.OBSERVER' not in window


def test_the_deny_sits_after_the_rollback():
    """Ordering is load-bearing, not cosmetic.

    The is_active SELECT autobegins a transaction. Raising before it is released
    leaves it open, which is the #103 regression where every subsequent write was
    silently rolled back into a savepoint.
    """
    src = inspect.getsource(deps.get_current_user)
    assert src.index("await db.rollback()") < src.index("Observer access is read-only")


# ── the enumeration guard ─────────────────────────────────────────────────────

# Mutating routes that legitimately never reach get_current_user. Every one is
# either pre-session (you cannot be authenticated yet) or authenticated by the
# separate X-Platform-Admin-Key authority. A 17th appearing here is a review
# question, not a rubber stamp.
_NO_SESSION_ALLOWLIST = {
    "/api/auth/login",
    "/api/auth/login/check",
    "/api/auth/logout",
    "/api/auth/password-reset/complete",
    "/api/auth/password-reset/request",
    "/api/auth/password-setup",
    "/api/auth/refresh",
    "/api/auth/signup/executive",
    "/api/auth/signup/supervisor",
    "/api/tenancy/admin/login",
    "/api/tenancy/join",
    "/api/tenancy/password-reset-requests/{request_id}/confirm",
    "/api/tenancy/request-workspace",
    "/api/tenancy/requests/{request_id}/approve",
    "/api/tenancy/requests/{request_id}/reject",
    "/api/tenancy/tenants/{tenant_id}/branding",
}

_MUTATING = {"POST", "PUT", "PATCH", "DELETE"}


def _reaches(dependant, target, seen=None) -> bool:
    """Walk the RESOLVED dependency graph rather than the source text.

    Stronger than inspect.getsource: it follows aliases (BusinessAdmin, EditorUser,
    …) and nested dependencies to whatever actually runs.
    """
    seen = seen or set()
    if id(dependant) in seen:
        return False
    seen.add(id(dependant))
    if dependant.call is target:
        return True
    return any(_reaches(d, target, seen) for d in dependant.dependencies)


def _mutating_routes():
    from app.main import app
    for route in app.routes:
        methods = getattr(route, "methods", set()) & _MUTATING
        if methods and hasattr(route, "dependant"):
            yield route


def test_every_mutating_route_reaches_the_chokepoint():
    """The deny only covers routes that pass through get_current_user.

    A new endpoint that authenticates some other way would be invisible to it —
    this is the test that says so out loud.
    """
    escaped = sorted(
        r.path for r in _mutating_routes()
        if not _reaches(r.dependant, deps.get_current_user)
        and r.path not in _NO_SESSION_ALLOWLIST
    )
    assert escaped == [], (
        "mutating route(s) bypass get_current_user, so the observer write-deny "
        f"does not cover them: {escaped}"
    )


def test_the_allowlist_has_not_rotted():
    """Every allowlisted path must still exist and still bypass the chokepoint.

    Without this, a renamed route would leave a dead entry silently widening the
    exception set.
    """
    bypassing = {
        r.path for r in _mutating_routes()
        if not _reaches(r.dependant, deps.get_current_user)
    }
    stale = sorted(_NO_SESSION_ALLOWLIST - bypassing)
    assert stale == [], f"allowlisted paths that no longer bypass the chokepoint: {stale}"


def test_every_mutating_route_carries_a_role_guard_or_is_public():
    """Defence in depth behind the chokepoint.

    The deny protects observers specifically; this asserts the ordinary role
    boundary is declared on the route rather than left to a handler body.
    """
    unguarded = []
    for route in _mutating_routes():
        if route.path in _NO_SESSION_ALLOWLIST:
            continue
        names = {
            getattr(d.call, "__qualname__", "") for d in _walk(route.dependant)
        }
        if not any(n.startswith("require_role") for n in names):
            unguarded.append(route.path)
    assert unguarded == [], f"mutating route(s) with no require_role dependency: {unguarded}"


def _walk(dependant, seen=None):
    seen = seen or set()
    if id(dependant) in seen:
        return
    seen.add(id(dependant))
    yield dependant
    for d in dependant.dependencies:
        yield from _walk(d, seen)
