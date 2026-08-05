"""Follow-ups to the observer audit (#472): two gaps it left, and one in its net.

The audit asked "can an observer read a credential" and fixed three routes. It
did not ask the mirror question — "can something else write an observer where an
observer must never be" — and it left the guard that proves the whole role safe
reading a hand-copied list.

Each test here failed before the fix in the same commit.
"""
from __future__ import annotations

import inspect

import pytest

from app.services import business_admin_service as svc


def _body(fn) -> str:
    """Source with the docstring stripped — these functions describe in prose
    the very things the assertions look for, so a naive substring check over the
    whole source matches the explanation instead of the code. Same helper as
    tests/test_observer_signup.py.
    """
    src = inspect.getsource(fn)
    parts = src.split('"""')
    return parts[0] + "".join(parts[2:]) if len(parts) >= 3 else src


# ── 1 · approve_supervisor must not accept an observer ────────────────────────
#
# The route takes a user_id. list_pending_supervisors filters role='supervisor'
# so the QUEUE never offers an observer — but approve had no such filter, so a
# request naming a pending observer's id activated it and wrote it a
# role_in_module='supervisor' membership.
#
# Not an escalation: _assert_may_write keys on users.role, which stays
# 'observer', so the account still cannot write. What broke was the invariant
# 20260816 claims — that an observer can never hold a module membership.


@pytest.mark.asyncio
async def test_approve_supervisor_scopes_its_lookup_to_the_supervisor_role(
    make_session, fake_result,
):
    """The SQL actually issued must carry the role predicate.

    Asserted on the emitted statement rather than the source text, so a refactor
    that keeps the words but changes the query cannot pass.
    """
    session = make_session(
        fake_result(mappings_rows=[{"is_active": False}]),  # the pending target
        fake_result(),                                       # UPDATE users
        fake_result(),                                       # INSERT membership
    )
    await svc.approve_supervisor(session, "tid-1", "uid-1", "bd")

    select_sql, update_sql = session.executed[0], session.executed[1]
    assert "role = 'supervisor'" in select_sql, (
        "approve_supervisor's target lookup accepts a user of ANY role — a "
        "pending observer's id would be activated by the supervisor queue"
    )
    assert "role = 'supervisor'" in update_sql, (
        "the UPDATE must carry the same predicate as the lookup, or a role that "
        "changed between the two statements would still be activated"
    )


@pytest.mark.asyncio
async def test_approve_supervisor_still_works_for_a_real_supervisor(
    make_session, fake_result,
):
    """The guard must not have broken the path it protects: a genuine pending
    supervisor is still activated AND still gets the membership row."""
    session = make_session(
        fake_result(mappings_rows=[{"is_active": False}]),
        fake_result(),
        fake_result(),
    )
    await svc.approve_supervisor(session, "tid-1", "uid-1", "bd")

    joined = " ".join(session.executed)
    assert "is_active = true" in joined
    assert "INSERT INTO user_module_memberships" in joined


@pytest.mark.asyncio
async def test_approve_supervisor_is_still_idempotent(make_session, fake_result):
    """An already-active row is still a no-op — the #123 double-click guard."""
    session = make_session(fake_result(mappings_rows=[{"is_active": True}]))
    await svc.approve_supervisor(session, "tid-1", "uid-1", "bd")
    assert len(session.executed) == 1, "an active target must stop after the lookup"


@pytest.mark.asyncio
async def test_a_missing_target_writes_nothing(make_session, fake_result):
    """What the role filter turns an observer's id INTO: no row found, so the
    function returns before any write. This is the shape of the fix."""
    session = make_session(fake_result(mappings_rows=[]))
    await svc.approve_supervisor(session, "tid-1", "observer-uid", "bd")
    joined = " ".join(session.executed)
    assert "INSERT" not in joined.upper()
    assert "UPDATE" not in joined.upper()


def test_both_approval_paths_scope_to_the_role_they_approve():
    """The invariant the DB does NOT enforce, asserted where it actually lives.

    role_in_module's CHECK constrains role_in_module, not users.role, so it
    permits 'supervisor' for an observer. Nothing in the schema stops it — only
    these two functions do, so both must keep their predicate.
    """
    assert "role = 'supervisor'" in _body(svc.approve_supervisor)
    assert "role = 'observer'" in _body(svc.approve_observer)


# ── 3 · the enumeration guard must walk main's own mount list ─────────────────


def test_the_route_walk_reads_mains_mount_list_rather_than_a_copy():
    """The observer role rests on "every mutating route reaches the chokepoint".

    test_observer_readonly proves that by walking a list of routers. While that
    list was a hand-copied duplicate of main.py's, a router mounted in main.py
    but not added there would have been walked by nothing — the assertions would
    have passed green over an unguarded mutating route. A safety net may fail;
    it may not go silent.
    """
    from app.main import ROUTERS
    from tests import test_observer_readonly as guard

    assert guard._routers() is ROUTERS, "the walk must BE main's list, not match it"

    src = inspect.getsource(guard._routers)
    assert "from app.main import ROUTERS" in src
    assert "from app.routers import" not in src, (
        "_routers re-listed the routers locally again — that is the drift this "
        "test exists to prevent"
    )


def test_every_mounted_router_is_actually_walked():
    """Belt and braces on the identity check above: the walk covers every router
    the app serves, so no mounted router's routes go un-enumerated."""
    from app.main import ROUTERS
    from tests import test_observer_readonly as guard

    walked = {id(m) for m in guard._routers()}
    missing = [m.__name__ for m in ROUTERS if id(m) not in walked]
    assert missing == [], f"routers mounted but never walked: {missing}"
