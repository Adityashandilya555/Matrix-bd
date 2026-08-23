"""An executive may report to several supervisors within one module.

Until migration 20260818, `user_module_memberships` carried
UNIQUE (user_id, module) and a single `supervisor_id`, so one row per
(user, module) meant one supervisor, structurally. If BD had two supervisors an
executive could be on one team or the other, never both.

Two things had to change together, and both are asserted here:

  1. the writers — `ON CONFLICT (user_id, module)` infers the index the migration
     removes, so all three inserts fail at runtime without the rewrite,
  2. an entry point — the executive cannot redeem a second invite code
     (_enqueue_signup 409s on an active email), so the supervisor adds them.

The third piece, the migration itself, is NOT asserted here. There is no live
database in this suite — RecordingSession records SQL and returns canned rows —
so any test of it could only restate the SQL as Python substrings, which a
correct rewrite would fail and a broken one that kept the strings would pass.
The reasoning that shaped that file lives in its own header, where it survives a
rewrite. Proving it needs one integration test against real Postgres.

The one exception below runs the application's own SQL splitter over the
migration, which is executing code rather than describing it.
"""
from __future__ import annotations

import inspect
import pathlib

import pytest
from fastapi import HTTPException

from app.services import business_admin_service, supervisor_code_service as svc

MIGRATION = pathlib.Path("database/migrations/20260818_multi_supervisor_executives.sql")

SUP = {"sub": "sup-2", "tenant_id": "t1", "name": "Supervisor Two"}


def _index_of(sess, needle, *, must_contain=None):
    """Position of the first recorded statement containing `needle`.

    Not a bare next(): that raises StopIteration, so a missing statement fails
    the test with an opaque error rather than naming what was not emitted.
    """
    for i, stmt in enumerate(sess.executed):
        if needle in stmt and (must_contain is None or must_contain in stmt):
            return i
    raise AssertionError(
        f"no statement containing {needle!r}"
        + (f" and {must_contain!r}" if must_contain else "")
        + f"; emitted: {[' '.join(q.split())[:60] for q in sess.executed]}"
    )


def _supervises(fake_result):
    """The `_assert_supervises_module` probe, answered yes."""
    return fake_result(all_rows=[(1,)])


# ── 1 · the storage ───────────────────────────────────────────────────────────


    # The DO block is naturally re-runnable: it drops whatever it finds, and on a
    # second pass finds nothing.


def test_the_runner_parses_the_do_block_whole():
    """The startup splitter cuts on semicolons; a DO block is full of them. If it
    shreds, the fragments run as separate statements and the migration fails in a
    way the ledger records as a hard error on every boot."""
    from app.main import _parse_sql_statements

    stmts = _parse_sql_statements(MIGRATION.read_text())
    assert len(stmts) == 3, [s[:40] for s in stmts]
    do_block = stmts[0]
    assert do_block.count("$$") == 2
    assert "RAISE EXCEPTION" in do_block


# ── 2 · the writers ───────────────────────────────────────────────────────────
#
# `ON CONFLICT (user_id, module)` names an index that the migration deletes.
# Postgres raises "no unique or exclusion constraint matching the ON CONFLICT
# specification" — so these are not style assertions, they are the difference
# between the insert working and the endpoint 500ing.

def test_no_writer_still_infers_the_dropped_index():
    for mod in (svc, business_admin_service):
        assert "ON CONFLICT (user_id, module) DO NOTHING" not in inspect.getsource(mod), mod.__name__
    from app.routers import users as users_router
    assert "ON CONFLICT (user_id, module) DO NOTHING" not in inspect.getsource(users_router)


@pytest.mark.asyncio
async def test_a_second_supervisors_approval_now_inserts(make_session, fake_result):
    """The old target swallowed it: the row already existed for (user, module),
    so approving the same executive under a second supervisor reported success
    and wrote nothing."""
    sess = make_session(fake_result(mappings_rows=[{
        "is_active": False, "role": "executive", "notes": "pending_supervisor:s|module:legal",
    }]))
    await svc.approve_my_pending_exec(
        sess, tenant_id="t", supervisor_id="s", user_id="u", module="legal",
    )
    assert "ON CONFLICT (user_id, module, supervisor_id)" in sess.sql
    assert "WHERE supervisor_id IS NOT NULL DO NOTHING" in sess.sql


@pytest.mark.asyncio
async def test_the_supervisor_insert_still_pins_to_one_row(make_session, fake_result):
    sess = make_session(fake_result(mappings_rows=[{"is_active": False}]))
    await business_admin_service.approve_supervisor(
        sess, tenant_id="t", user_id="u", module="design",
    )
    assert "ON CONFLICT (user_id, module) WHERE supervisor_id IS NULL" in sess.sql


# ── 3 · the supervisor adds an existing executive ─────────────────────────────

@pytest.mark.asyncio
async def test_linking_writes_a_second_row(make_session, fake_result):
    sess = make_session(
        _supervises(fake_result),
        fake_result(mappings_rows=[{"is_active": True, "role": "executive", "in_module": True}]),
    )
    await svc.add_existing_executive(sess, SUP, "bd", "exe-1")
    assert "INSERT INTO user_module_memberships" in sess.sql
    assert "'executive'" in sess.sql


@pytest.mark.asyncio
async def test_linking_is_idempotent_rather_than_conflicting(make_session, fake_result):
    """A supervisor who double-clicks should get a no-op, not a 409."""
    sess = make_session(
        _supervises(fake_result),
        fake_result(mappings_rows=[{"is_active": True, "role": "executive", "in_module": True}]),
    )
    await svc.add_existing_executive(sess, SUP, "bd", "exe-1")
    assert "ON CONFLICT (user_id, module, supervisor_id)" in sess.sql
    assert "DO NOTHING" in sess.sql


@pytest.mark.asyncio
async def test_a_supervisor_of_another_module_is_refused(make_session, fake_result):
    """require_role(SUPERVISOR) proves the caller supervises SOMETHING. Without
    this check a legal supervisor could rearrange the BD teams."""
    sess = make_session(fake_result(all_rows=[]))
    with pytest.raises(HTTPException) as exc:
        await svc.add_existing_executive(sess, SUP, "bd", "exe-1")
    assert exc.value.status_code == 403
    assert "INSERT" not in sess.sql


@pytest.mark.asyncio
async def test_an_executive_outside_the_module_is_refused(make_session, fake_result):
    """The module boundary is the thing this endpoint must not widen. It adds a
    second supervisor to an existing member; it is not a way to pull someone
    across a boundary that require_module exists to hold."""
    sess = make_session(
        _supervises(fake_result),
        fake_result(mappings_rows=[{"is_active": True, "role": "executive", "in_module": False}]),
    )
    with pytest.raises(HTTPException) as exc:
        await svc.add_existing_executive(sess, SUP, "bd", "exe-1")
    assert exc.value.status_code == 400
    assert "INSERT" not in sess.sql


@pytest.mark.asyncio
@pytest.mark.parametrize("target,why", [
    ({"is_active": False, "role": "executive", "in_module": True}, "inactive"),
    ({"is_active": True, "role": "supervisor", "in_module": True}, "a supervisor"),
    ({"is_active": True, "role": "business_admin", "in_module": True}, "an admin"),
    (None, "missing"),
])
async def test_only_an_active_executive_can_be_linked(make_session, fake_result, target, why):
    sess = make_session(
        _supervises(fake_result),
        fake_result(mappings_rows=[target] if target else []),
    )
    with pytest.raises(HTTPException) as exc:
        await svc.add_existing_executive(sess, SUP, "bd", "exe-1")
    assert exc.value.status_code == 404, why
    assert "INSERT" not in sess.sql


# ── unlinking ─────────────────────────────────────────────────────────────────

def _shared(fake_result):
    """The 'another supervisor also has them' probe, answered yes."""
    return fake_result(all_rows=[(1,)])


@pytest.mark.asyncio
async def test_a_supervisor_unlinks_only_their_own_link(make_session, fake_result):
    """Scoped to the caller: an executive shared with another supervisor keeps
    working for them, and the account is never deactivated from here."""
    sess = make_session(_supervises(fake_result), _shared(fake_result))
    await svc.remove_from_my_team(sess, SUP, "bd", "exe-1")
    assert "DELETE FROM user_module_memberships" in sess.sql
    assert "supervisor_id = :sid" in sess.sql
    assert "UPDATE users" not in sess.sql


@pytest.mark.asyncio
async def test_unlinking_cannot_reach_a_supervisor_row(make_session, fake_result):
    """role_in_module is pinned, so a crafted user_id cannot delete a peer
    supervisor's own membership."""
    sess = make_session(_supervises(fake_result), _shared(fake_result))
    await svc.remove_from_my_team(sess, SUP, "bd", "exe-1")
    assert "role_in_module = 'executive'" in sess.sql


@pytest.mark.asyncio
async def test_removing_the_only_link_in_a_module_is_refused(make_session, fake_result):
    """The state it would create has no way out. Everything downstream is
    membership-driven: the admin's card joins through the membership table so the
    person disappears from it and cannot be selected for removal; no supervisor
    can re-add them, because available-executives requires a row in the module;
    and re-redeeming an invite code 409s on an active email. The account would sit
    active and signed in with a null module claim, bounced off every route."""
    sess = make_session(_supervises(fake_result), fake_result(all_rows=[]))
    with pytest.raises(HTTPException) as exc:
        await svc.remove_from_my_team(sess, SUP, "bd", "exe-1")
    assert exc.value.status_code == 409
    assert "business admin" in exc.value.detail
    assert "DELETE" not in sess.sql


@pytest.mark.asyncio
async def test_the_last_link_check_ignores_my_own_row(make_session, fake_result):
    """IS DISTINCT FROM, not <>: the caller's own row must not count as 'someone
    else still has them', and a NULL supervisor_id row must still count as one."""
    sess = make_session(_supervises(fake_result), _shared(fake_result))
    await svc.remove_from_my_team(sess, SUP, "bd", "exe-1")
    assert "supervisor_id IS DISTINCT FROM" in sess.sql


# ── the admin's Remove button ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_remove_without_context_still_deactivates(make_session, fake_result):
    """Supervisors and the unassigned list send no context, and must keep the
    behaviour they have always had."""
    sess = make_session(fake_result(mappings_rows=[{"is_active": True, "role": "executive"}]))
    await business_admin_service.unlink_or_deactivate_org_user(
        sess, "t1", "exe-1", {"sub": "admin"},
    )
    assert "UPDATE users SET is_active = false" in sess.sql
    assert "DELETE FROM user_module_memberships" not in sess.sql


@pytest.mark.asyncio
async def test_remove_inside_a_supervisors_group_unlinks_only(make_session, fake_result):
    """Still has another team, so the account stays live."""
    sess = make_session(
        fake_result(),                           # SELECT ... FOR UPDATE on users
        fake_result(rowcount=1),                 # the DELETE
        fake_result(all_rows=[(1,)]),            # a membership remains
    )
    await business_admin_service.unlink_or_deactivate_org_user(
        sess, "t1", "exe-1", {"sub": "admin"}, module="bd", supervisor_id="sup-1",
    )
    assert "DELETE FROM user_module_memberships" in sess.sql
    assert "UPDATE users SET is_active = false" not in sess.sql


@pytest.mark.asyncio
async def test_removing_the_last_link_deactivates(make_session, fake_result):
    """Otherwise the account stays active belonging to nobody — signed in, in no
    module, seeing nothing."""
    sess = make_session(
        fake_result(),                                                    # the row lock
        fake_result(rowcount=1),                                          # the DELETE
        fake_result(all_rows=[]),                                         # nothing left
        fake_result(mappings_rows=[{"is_active": True, "role": "executive"}]),
    )
    await business_admin_service.unlink_or_deactivate_org_user(
        sess, "t1", "exe-1", {"sub": "admin"}, module="bd", supervisor_id="sup-1",
    )
    assert "DELETE FROM user_module_memberships" in sess.sql
    assert "UPDATE users SET is_active = false" in sess.sql


@pytest.mark.asyncio
async def test_naming_a_module_without_a_supervisor_falls_back(make_session, fake_result):
    """Ambiguous once an executive holds several links in that module, so it is
    treated as no context rather than guessed at."""
    sess = make_session(fake_result(mappings_rows=[{"is_active": True, "role": "executive"}]))
    await business_admin_service.unlink_or_deactivate_org_user(
        sess, "t1", "exe-1", {"sub": "admin"}, module="bd", supervisor_id=None,
    )
    assert "DELETE FROM user_module_memberships" not in sess.sql
    assert "UPDATE users SET is_active = false" in sess.sql


# ── the org tree ──────────────────────────────────────────────────────────────

def _rows(*pairs):
    """(exec_id, supervisor_id) → the row shape list_org builds."""
    return [{"id": e, "email": f"{e}@x.com", "name": e, "_supervisor_id": s} for e, s in pairs]


def test_a_shared_executive_nests_under_every_supervisor():
    """The point of the whole change, at the display layer."""
    index = {"sup-1": {"id": "sup-1", "executives": []}, "sup-2": {"id": "sup-2", "executives": []}}
    unassigned = business_admin_service._place_executives(
        _rows(("exe-1", "sup-1"), ("exe-1", "sup-2")), index,
    )
    assert [e["id"] for e in index["sup-1"]["executives"]] == ["exe-1"]
    assert [e["id"] for e in index["sup-2"]["executives"]] == ["exe-1"]
    assert unassigned == []


def test_a_shared_executive_is_not_also_listed_as_unassigned():
    """The FK is ON DELETE SET NULL, so an executive can hold a leftover
    NULL-supervisor row alongside a real one. Without the first pass they render
    under a supervisor AND in Unassigned executives, as two different people."""
    index = {"sup-2": {"id": "sup-2", "executives": []}}
    unassigned = business_admin_service._place_executives(
        _rows(("exe-1", None), ("exe-1", "sup-2")), index,
    )
    assert [e["id"] for e in index["sup-2"]["executives"]] == ["exe-1"]
    assert unassigned == []


def test_a_genuinely_orphaned_executive_is_still_listed_once():
    """No row of theirs resolves, so they belong in Unassigned — but only once,
    however many dangling rows they carry."""
    unassigned = business_admin_service._place_executives(
        _rows(("exe-1", None), ("exe-1", "sup-gone")), {},
    )
    assert [e["id"] for e in unassigned] == ["exe-1"]


def test_a_row_pointing_at_a_supervisor_in_another_module_does_not_place_them():
    """`index` holds only THIS module's supervisors, so a stale id must fall
    through to unassigned rather than being silently dropped."""
    unassigned = business_admin_service._place_executives(
        _rows(("exe-1", "sup-in-legal")), {"sup-1": {"id": "sup-1", "executives": []}},
    )
    assert [e["id"] for e in unassigned] == ["exe-1"]


def test_the_marker_never_leaks_into_the_response():
    """_supervisor_id is internal bookkeeping; the API shape must not grow it."""
    index = {"sup-1": {"id": "sup-1", "executives": []}}
    unassigned = business_admin_service._place_executives(
        _rows(("exe-1", "sup-1"), ("exe-2", None)), index,
    )
    for person in index["sup-1"]["executives"] + unassigned:
        assert "_supervisor_id" not in person


# ── determinism ───────────────────────────────────────────────────────────────

def test_the_session_query_orders_its_now_multiple_rows():
    """deps.py's LEFT JOIN can match once per supervisor and takes .first()."""
    from app.core import deps
    src = inspect.getsource(deps.get_current_user)
    assert "ORDER BY COALESCE(umm.has_executive_access, false) DESC" in src


# ── the route contract ────────────────────────────────────────────────────────
#
# The gap that let a dead endpoint ship green. Service tests call the function
# and never see the response_model; the frontend test mocks the adapter and never
# sees the route. Nothing in between validated what one returns against what the
# other declares — and an EMPTY list validates against any model, so the endpoint
# looked healthy right up until it had something to say.

def _row(**over):
    base = {"id": "u1", "email": "e@x.com", "name": "E", "module": "bd"}
    base.update(over)
    return base


def test_available_executives_validates_against_its_response_model():
    from pydantic import TypeAdapter

    from app.routers import supervisor_codes as router_mod

    model = router_mod.AvailableExecutiveOut
    TypeAdapter(list[model]).validate_python([_row()])


def test_the_available_list_does_not_reuse_the_team_model():
    """TeamMemberOut carries joined_at — the date they joined MY team. The whole
    point of this list is that they have not, so there is no value to put there."""
    from app.routers import supervisor_codes as router_mod

    assert "joined_at" not in router_mod.AvailableExecutiveOut.model_fields
    assert "joined_at" in router_mod.TeamMemberOut.model_fields


def test_the_unlink_and_the_deactivation_are_one_transaction():
    """db/session.py's transaction() COMMITS on exit when none is open, and takes
    a savepoint when one is. So calling deactivate_org_user after the block makes
    two committed transactions: the DELETE would already be durable if the
    deactivation then raised, leaving the admin an error and a deleted row.
    Inside the block it nests, and the two move together.

    Checked against the AST, not indentation — a sibling `if` after the block is
    also more indented than the `async with` line, so counting spaces cannot tell
    the two apart.
    """
    import ast
    import textwrap

    src = textwrap.dedent(
        inspect.getsource(business_admin_service.unlink_or_deactivate_org_user)
    )
    fn = ast.parse(src).body[0]

    def calls_deactivate(node):
        return any(
            isinstance(n, ast.Call)
            and getattr(n.func, "id", getattr(n.func, "attr", None)) == "deactivate_org_user"
            for n in ast.walk(node)
        )

    blocks = [n for n in ast.walk(fn) if isinstance(n, ast.AsyncWith)]
    assert blocks, "the transaction block is gone"
    assert any(calls_deactivate(b) for b in blocks), (
        "deactivate_org_user is not inside `async with transaction(session)` — "
        "the DELETE would commit separately from the deactivation"
    )


# ── the two writers serialise on the users row ────────────────────────────────
#
# add_existing_executive checks the target then inserts; unlink_or_deactivate
# counts memberships then deactivates. Both are read-then-act, and they act on
# each other's state — so they take the same row lock or they interleave.

@pytest.mark.asyncio
async def test_linking_locks_the_target_before_inserting(make_session, fake_result):
    """Otherwise an admin can deactivate between the check and the INSERT,
    leaving a switched-off account holding a brand-new team link."""
    sess = make_session(
        _supervises(fake_result),
        fake_result(mappings_rows=[{"is_active": True, "role": "executive", "in_module": True}]),
    )
    await svc.add_existing_executive(sess, SUP, "bd", "exe-1")
    lock = _index_of(sess, "FROM users u", must_contain="FOR UPDATE")
    insert = _index_of(sess, "INSERT INTO user_module_memberships")
    assert lock < insert


@pytest.mark.asyncio
async def test_unlinking_takes_the_same_lock_before_counting(make_session, fake_result):
    """The other side. Without it a supervisor can add a link between the
    membership count and the deactivation, and an executive with a live team gets
    switched off."""
    sess = make_session(
        fake_result(), fake_result(rowcount=1), fake_result(all_rows=[(1,)]),
    )
    await business_admin_service.unlink_or_deactivate_org_user(
        sess, "t1", "exe-1", {"sub": "admin"}, module="bd", supervisor_id="sup-1",
    )
    lock = _index_of(sess, "FROM users", must_contain="FOR UPDATE")
    delete = _index_of(sess, "DELETE FROM user_module_memberships")
    assert lock < delete


def test_the_primary_membership_prefers_a_real_supervisor():
    """NULLS LAST, not FIRST. A NULL supervisor_id is an ORPHANED link — the FK
    is ON DELETE SET NULL — so preferring it mints a JWT with no supervisor for
    someone who still has a perfectly good team in that module."""
    from app.services import auth_repo

    src = inspect.getsource(auth_repo.get_primary_membership)
    assert "supervisor_id NULLS LAST" in src
    assert "NULLS FIRST" not in src


# ── a half-filled remove payload is rejected, not guessed at ──────────────────

@pytest.mark.parametrize("payload,accepted", [
    ({}, True),
    ({"module": "bd", "supervisor_id": "sup-1"}, True),
    ({"module": "bd"}, False),
    ({"supervisor_id": "sup-1"}, False),
])
def test_remove_context_is_both_fields_or_neither(payload, accepted):
    """The service reads a missing pair as "no context", which is whole-account
    deactivation — so a half-filled payload would switch an account off when it
    meant to unlink one team."""
    import pydantic

    from app.domain.schemas.business_admin import RemoveOrgUserIn

    if accepted:
        RemoveOrgUserIn(**payload)
    else:
        with pytest.raises(pydantic.ValidationError):
            RemoveOrgUserIn(**payload)
