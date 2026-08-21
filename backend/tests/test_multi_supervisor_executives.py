"""An executive may report to several supervisors within one module.

Until migration 20260818, `user_module_memberships` carried
UNIQUE (user_id, module) and a single `supervisor_id`, so one row per
(user, module) meant one supervisor, structurally. If BD had two supervisors an
executive could be on one team or the other, never both.

Three things had to change together, and each is asserted here:

  1. the storage — two partial unique indexes instead of the composite one,
  2. the writers — `ON CONFLICT (user_id, module)` infers the index that no
     longer exists, so all three inserts fail at runtime without this,
  3. an entry point — the executive cannot redeem a second invite code
     (_enqueue_signup 409s on an active email), so the supervisor adds them.

The suite has no live database — RecordingSession records SQL and returns canned
rows — so these assert the emitted statements and the branch decisions. The
partial-index inference itself is only provable against real Postgres; see the
manual steps in the PR.
"""
from __future__ import annotations

import inspect
import pathlib

import pytest
from fastapi import HTTPException

from app.services import business_admin_service, supervisor_code_service as svc

MIGRATION = pathlib.Path("database/migrations/20260818_multi_supervisor_executives.sql")
SCHEMA = pathlib.Path("database/schema.sql")

SUP = {"sub": "sup-2", "tenant_id": "t1", "name": "Supervisor Two"}


def _supervises(fake_result):
    """The `_assert_supervises_module` probe, answered yes."""
    return fake_result(all_rows=[(1,)])


# ── 1 · the storage ───────────────────────────────────────────────────────────

def test_the_composite_unique_is_gone_from_the_schema():
    """It is what made one supervisor per module structural."""
    assert "user_module_memberships_user_module_key" not in SCHEMA.read_text()


def test_the_migration_does_not_drop_by_a_guessed_name():
    """The trap this walked into once already.

    schema.sql spells the constraint `user_module_memberships_user_module_key`,
    and dropping that name looks obviously right. But schema.sql is never
    executed (docs/10-change-management/change-rules.md calls it a historical
    snapshot), and the migration that actually created the table —
    202605265_user_module_memberships_table.sql — declares `UNIQUE (user_id,
    module)` ANONYMOUSLY, so Postgres generated a different name.

    DROP ... IF EXISTS on a wrong name matches nothing and succeeds. The old
    constraint would survive, every second-supervisor INSERT would raise a unique
    violation the ON CONFLICT arbiter does not cover, and the deploy would report
    success. So the name must be discovered, never written down.
    """
    sql = MIGRATION.read_text()
    body = "\n".join(
        line for line in sql.splitlines() if not line.strip().startswith("--")
    )
    assert "user_module_memberships_user_module_key" not in body
    assert "pg_constraint" in body, "the constraint must be found, not named"


def test_the_migration_refuses_to_finish_if_the_drop_did_nothing():
    """A migration that cannot do its job must fail loudly rather than record
    itself applied. Without this the failure mode is a green deploy and a feature
    that 500s on first use."""
    body = MIGRATION.read_text()
    assert "RAISE EXCEPTION" in body
    assert body.index("RAISE EXCEPTION") < body.index("CREATE UNIQUE INDEX")


def test_the_guard_ignores_the_two_partial_indexes_it_creates():
    """Both new indexes are on (user_id, module[, supervisor_id]). If the
    left-over check counted partial ones it would fire on the second run and
    every run after."""
    body = MIGRATION.read_text()
    assert body.count("indpred IS NULL") >= 2


def test_supervisors_are_still_one_row_per_module():
    """The rule only loosens for executives. A supervisor row carries
    supervisor_id NULL and the partial index still pins it to one."""
    sql = SCHEMA.read_text()
    assert "uq_umm_user_module_unsupervised" in sql
    idx = sql[sql.index("uq_umm_user_module_unsupervised"):]
    assert "(user_id, module)" in idx[:200]
    assert "WHERE supervisor_id IS NULL" in idx[:200]


def test_executives_get_one_row_per_supervisor():
    sql = SCHEMA.read_text()
    idx = sql[sql.index("uq_umm_user_module_supervisor"):]
    assert "(user_id, module, supervisor_id)" in idx[:200]
    assert "WHERE supervisor_id IS NOT NULL" in idx[:200]


def test_the_migration_drops_before_it_creates():
    """Both indexes overlap the old constraint's key, so creating first would
    fail on any workspace that already has data."""
    sql = MIGRATION.read_text()
    assert sql.index("DROP CONSTRAINT") < sql.index("CREATE UNIQUE INDEX")


def test_the_migration_is_rerunnable():
    """The ledger keys on filename + checksum, but a half-applied file retries
    on the next boot — every statement has to tolerate having already run."""
    sql = MIGRATION.read_text()
    assert sql.count("CREATE UNIQUE INDEX IF NOT EXISTS") == 2
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


def test_an_empty_list_is_not_evidence_the_model_fits():
    """Why the mismatch survived review: this passes with ANY model."""
    from pydantic import TypeAdapter

    from app.routers import supervisor_codes as router_mod

    assert TypeAdapter(list[router_mod.TeamMemberOut]).validate_python([]) == []
    with pytest.raises(Exception):
        TypeAdapter(list[router_mod.TeamMemberOut]).validate_python([_row()])
