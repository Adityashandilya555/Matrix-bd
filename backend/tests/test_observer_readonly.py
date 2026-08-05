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
    src = inspect.getsource(deps._assert_may_write)
    assert 'claims.get("real_role")' in src
    assert 'claims.get("role")' not in src


def test_the_deny_sits_after_the_rollback():
    """Ordering is load-bearing, not cosmetic.

    The is_active SELECT autobegins a transaction. Raising before it is released
    leaves it open, which is the #103 regression where every subsequent write was
    silently rolled back into a savepoint.
    """
    src = inspect.getsource(deps.get_current_user)
    assert src.index("await db.rollback()") < src.index("_assert_may_write(")


# ── the enumeration guard ─────────────────────────────────────────────────────
#
# Inspect the ROUTER objects, not app.main.app.routes. The assembled app's route
# list is mutated by other tests (test_batch_sec_auth_config adds and removes a
# route), which makes app-level assertions order-dependent — green locally, red
# in CI. test_qa_report_view_routes.py carries the same warning; this test learned
# it the hard way.
#
# That warning is about the assembled app's ROUTE LIST, not about importing
# main at all — so the router tuple itself comes from app.main.ROUTERS. This
# test used to keep a hand-copied duplicate of that list, which meant a router
# mounted in main.py but not added here would have been walked by nothing: the
# assertions below would have passed green over an unguarded mutating route.
# Silence is the one failure mode a safety net must not have.
#
# Matching is by qualified NAME rather than object identity, so a module imported
# under two paths cannot make a guarded route look unguarded.

# Mutating routes that legitimately never reach get_current_user. Every one is
# either pre-session (you cannot be authenticated yet) or authenticated by the
# separate X-Platform-Admin-Key authority. Paths are router-relative — the
# app-level /api prefix comes from settings and is not hardcoded here.
_NO_SESSION_ALLOWLIST = {
    "/auth/login",
    "/auth/login/check",
    "/auth/logout",
    "/auth/password-reset/complete",
    "/auth/password-reset/request",
    "/auth/password-setup",
    "/auth/refresh",
    "/auth/signup/executive",
    # Pre-session by nature: the person signing up has no account yet, so there
    # is nobody to authenticate. Guarded instead by the same rate limit as the
    # other two signups and by requiring a live workspace observer code.
    "/auth/signup/observer",
    "/auth/signup/supervisor",
    "/tenancy/admin/login",
    "/tenancy/join",
    "/tenancy/password-reset-requests/{request_id}/confirm",
    "/tenancy/request-workspace",
    "/tenancy/requests/{request_id}/approve",
    "/tenancy/requests/{request_id}/reject",
    "/tenancy/tenants/{tenant_id}/branding",
}

_MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
_CHOKEPOINT = "get_current_user"


def _routers():
    """Every router main.py mounts — read from main itself, never re-listed.

    Imported lazily so collection of this module does not depend on the app
    assembling successfully.
    """
    from app.main import ROUTERS
    return ROUTERS


def _dep_names(dependant, seen=None):
    """Every dependency callable's qualified name, walked recursively."""
    seen = set() if seen is None else seen
    if id(dependant) in seen:
        return
    seen.add(id(dependant))
    call = getattr(dependant, "call", None)
    if call is not None:
        yield getattr(call, "__qualname__", getattr(call, "__name__", ""))
    for d in dependant.dependencies:
        yield from _dep_names(d, seen)


def _mutating_routes():
    for mod in _routers():
        for route in mod.router.routes:
            if getattr(route, "methods", set()) & _MUTATING and hasattr(route, "dependant"):
                yield route


def test_the_route_inventory_is_not_empty():
    """A silently empty walk would make every assertion below vacuous — which is
    exactly how the first version of this test passed while proving nothing."""
    routes = list(_mutating_routes())
    assert len(routes) > 100, f"only found {len(routes)} mutating routes"


def test_every_mutating_route_reaches_the_chokepoint():
    """The write-deny only covers routes that pass through get_current_user.

    A new endpoint authenticating some other way would be invisible to it.
    """
    escaped = sorted(
        r.path for r in _mutating_routes()
        if _CHOKEPOINT not in set(_dep_names(r.dependant))
        and r.path not in _NO_SESSION_ALLOWLIST
    )
    assert escaped == [], (
        "mutating route(s) bypass get_current_user, so the observer write-deny "
        f"does not cover them: {escaped}"
    )


def test_the_allowlist_has_not_rotted():
    """Every allowlisted path must still exist and still bypass the chokepoint,
    so a renamed route cannot leave a dead entry quietly widening the exceptions."""
    bypassing = {
        r.path for r in _mutating_routes()
        if _CHOKEPOINT not in set(_dep_names(r.dependant))
    }
    stale = sorted(_NO_SESSION_ALLOWLIST - bypassing)
    assert stale == [], f"allowlisted paths that no longer bypass the chokepoint: {stale}"


def test_every_mutating_route_carries_a_role_guard_or_is_public():
    """Defence in depth behind the chokepoint: the ordinary role boundary should
    be declared on the route, not left to an inline check in a handler body."""
    unguarded = sorted(
        r.path for r in _mutating_routes()
        if r.path not in _NO_SESSION_ALLOWLIST
        and not any(n.startswith("require_role") for n in _dep_names(r.dependant))
    )
    assert unguarded == [], f"mutating route(s) with no require_role dependency: {unguarded}"
