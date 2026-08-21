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
    assert "DROP CONSTRAINT IF EXISTS" in sql
    assert sql.count("CREATE UNIQUE INDEX IF NOT EXISTS") == 2


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

@pytest.mark.asyncio
async def test_a_supervisor_unlinks_only_their_own_link(make_session, fake_result):
    """Scoped to the caller: an executive shared with another supervisor keeps
    working for them, and the account is never deactivated from here."""
    sess = make_session(_supervises(fake_result))
    await svc.remove_from_my_team(sess, SUP, "bd", "exe-1")
    assert "DELETE FROM user_module_memberships" in sess.sql
    assert "supervisor_id = :sid" in sess.sql
    assert "UPDATE users" not in sess.sql


@pytest.mark.asyncio
async def test_unlinking_cannot_reach_a_supervisor_row(make_session, fake_result):
    """role_in_module is pinned, so a crafted user_id cannot delete a peer
    supervisor's own membership."""
    sess = make_session(_supervises(fake_result))
    await svc.remove_from_my_team(sess, SUP, "bd", "exe-1")
    assert "role_in_module = 'executive'" in sess.sql


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

def test_a_shared_executive_is_not_also_listed_as_unassigned():
    """The FK is ON DELETE SET NULL, so an executive can hold a leftover
    NULL-supervisor row alongside a real one. Without the fix they would render
    under a supervisor AND in Unassigned executives, as two different people."""
    src = inspect.getsource(business_admin_service.list_org)
    assert "placed" in src and "seen_unassigned" in src


# ── determinism ───────────────────────────────────────────────────────────────

def test_the_session_query_orders_its_now_multiple_rows():
    """deps.py's LEFT JOIN can match once per supervisor and takes .first()."""
    from app.core import deps
    src = inspect.getsource(deps.get_current_user)
    assert "ORDER BY COALESCE(umm.has_executive_access, false) DESC" in src
