"""Executive cross-module workspace access (migration 20261022).

An executive of one module may be granted executive access to another, under a
supervisor of that module they choose. As with the supervisor grant
(tests/test_supervisor_module_access.py) no membership row is written; the
grant row is the access and the reporting line.

The claim-rewrite half drives the real ``get_current_user`` against the
RecordingSession stand-in, like the supervisor tests do.
"""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core import deps
from app.core.security import issue_token
from app.db import models
from app.services import executive_module_access_service as exec_svc
from app.services import supervisor_code_service as codes_svc

from tests.conftest import FakeResult, RecordingSession

TENANT = "00000000-0000-0000-0000-0000000000aa"
USER = "00000000-0000-0000-0000-0000000000bb"
SUPERVISOR = "00000000-0000-0000-0000-0000000000cc"
REQ_ID = "00000000-0000-0000-0000-0000000000c1"
GRANT_ID = "00000000-0000-0000-0000-0000000000c2"


class _Req:
    def __init__(self, method: str = "GET", path: str = "/api/sites") -> None:
        self.method = method
        self.url = SimpleNamespace(path=path)


def _token(module: str | None = "legal") -> str:
    return issue_token(
        sub=USER, email="ravi@example.com", name="Ravi",
        role="executive", tenant_id=TENANT, city="Gurugram", module=module,
    )


def _session(*, grant: bool = False, supervisor_grant: bool = False) -> RecordingSession:
    return RecordingSession(results=[FakeResult(mappings_rows=[{
        "role": "executive",
        "is_active": True,
        "has_executive_access": False,
        "has_pending_executive_request": False,
        "has_module_grant": supervisor_grant,
        "has_exec_module_grant": grant,
    }])])


async def _resolve(
    *, grant: bool = False, supervisor_grant: bool = False,
    override_role: str | None = None, override_module: str | None = None,
    path: str = "/api/sites", db: RecordingSession | None = None,
) -> dict:
    return await deps.get_current_user(
        _Req("GET", path),
        db if db is not None else _session(grant=grant, supervisor_grant=supervisor_grant),
        authorization=f"Bearer {_token()}",
        x_override_role=override_role,
        x_override_module=override_module,
    )


def _sql_containing(sess: RecordingSession, needle: str) -> str:
    for sql in sess.executed:
        if needle in sql:
            return sql
    raise AssertionError(f"no statement containing {needle!r}; emitted: {sess.executed}")


def _audits(sess: RecordingSession) -> list[str]:
    return [a.action for a in sess.added if hasattr(a, "action")]


def _notifications(sess: RecordingSession) -> list[tuple[str, str]]:
    return [
        (n.type, str(n.recipient_id))
        for n in sess.added if isinstance(n, models.NotificationOutbox)
    ]


# ── entering a borrowed module ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_an_executive_with_an_approved_grant_enters_the_other_module():
    claims = await _resolve(grant=True, override_module="design")
    assert claims["module"] == "design"
    assert claims["role"] == "executive"
    assert claims["borrowed_module"] == "design"
    assert claims["home_module"] == "legal"
    assert claims["real_role"] == "executive"


@pytest.mark.asyncio
async def test_an_executive_without_a_grant_is_refused_rather_than_ignored():
    """Before 20261022 the header was silently dropped for executives, so a
    request ran against Legal while the client believed it was in Design."""
    with pytest.raises(HTTPException) as exc:
        await _resolve(override_module="design")
    assert exc.value.status_code == 403
    assert "design" in exc.value.detail


@pytest.mark.asyncio
async def test_a_supervisor_grant_flag_does_not_admit_an_executive():
    """The two grant tables are probed separately; an executive must not ride
    on the supervisor EXISTS."""
    with pytest.raises(HTTPException):
        await _resolve(supervisor_grant=True, override_module="design")


@pytest.mark.asyncio
async def test_a_grant_cannot_change_the_executives_role():
    claims = await _resolve(grant=True, override_role="supervisor", override_module="design")
    assert claims["role"] == "executive"


@pytest.mark.asyncio
async def test_the_home_module_override_is_a_no_op_for_an_executive():
    claims = await _resolve(override_module="legal")
    assert claims["module"] == "legal"
    assert "borrowed_module" not in claims


@pytest.mark.asyncio
async def test_whoami_reports_the_refusal_instead_of_raising():
    claims = await _resolve(override_module="design", path="/api/auth/whoami")
    assert claims["workspace_access_refused"] == "design"
    assert claims["module"] == "legal"


@pytest.mark.asyncio
async def test_the_executive_grant_is_probed_for_the_requested_module():
    db = _session(grant=True)
    await _resolve(db=db, override_module="design")
    sql = db.executed[0]
    assert "executive_module_access_grants" in sql
    assert "eg.module = :mod" in sql
    assert db.execute_params[0]["mod"] == "design"


# ── the request ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("module", ["legal", "nso"])
async def test_the_home_module_and_nso_are_refused_before_any_sql(module):
    sess = RecordingSession()
    with pytest.raises(HTTPException) as exc:
        await exec_svc.request_access(
            sess, executive_id=USER, tenant_id=TENANT, home_module="legal",
            module=module, target_supervisor_id=SUPERVISOR,
        )
    assert exc.value.status_code == 400
    assert sess.executed == []


@pytest.mark.asyncio
async def test_the_supervisor_list_refuses_nso():
    sess = RecordingSession()
    with pytest.raises(HTTPException) as exc:
        await exec_svc.list_module_supervisors(
            sess, tenant_id=TENANT, module="nso", home_module="legal",
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_a_supervisor_who_does_not_supervise_the_module_is_refused():
    sess = RecordingSession(results=[FakeResult(all_rows=[])])
    with pytest.raises(HTTPException) as exc:
        await exec_svc.request_access(
            sess, executive_id=USER, tenant_id=TENANT, home_module="legal",
            module="design", target_supervisor_id=SUPERVISOR,
        )
    assert exc.value.status_code == 400
    assert not any("INSERT" in s for s in sess.executed)
    check = sess.executed[0]
    assert "role_in_module = 'supervisor'" in check
    assert "u.is_active = true" in check


@pytest.mark.asyncio
async def test_a_malformed_supervisor_id_is_a_400_not_a_500():
    sess = RecordingSession()
    with pytest.raises(HTTPException) as exc:
        await exec_svc.request_access(
            sess, executive_id=USER, tenant_id=TENANT, home_module="legal",
            module="design", target_supervisor_id="nope",
        )
    assert exc.value.status_code == 400
    assert sess.executed == []


@pytest.mark.asyncio
async def test_a_second_live_request_for_the_module_is_a_conflict():
    sess = RecordingSession(results=[
        FakeResult(all_rows=[(1,)]),
        FakeResult(mappings_rows=[]),   # ON CONFLICT swallowed the insert
    ])
    with pytest.raises(HTTPException) as exc:
        await exec_svc.request_access(
            sess, executive_id=USER, tenant_id=TENANT, home_module="legal",
            module="design", target_supervisor_id=SUPERVISOR,
        )
    assert exc.value.status_code == 409
    assert sess.added == []


@pytest.mark.asyncio
async def test_a_request_infers_the_partial_index_and_notifies_admins():
    sess = RecordingSession(results=[
        FakeResult(all_rows=[(1,)]),
        FakeResult(mappings_rows=[{"id": REQ_ID}]),
        FakeResult(scalars_list=["00000000-0000-0000-0000-00000000ad01"]),
    ])
    await exec_svc.request_access(
        sess, executive_id=USER, tenant_id=TENANT, home_module="legal",
        module="design", target_supervisor_id=SUPERVISOR, actor_name="Ravi",
    )
    insert_sql = _sql_containing(sess, "INSERT INTO executive_module_access_grants")
    assert "ON CONFLICT (executive_id, module)" in insert_sql
    assert "WHERE status IN ('pending', 'approved') DO NOTHING" in insert_sql
    assert _audits(sess) == ["executive_module_access_requested"]
    assert _notifications(sess) == [
        ("executive_module_access_requested", "00000000-0000-0000-0000-00000000ad01"),
    ]


# ── cancel ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cancel_only_touches_the_callers_own_pending_row():
    sess = RecordingSession(results=[FakeResult(mappings_rows=[{"module": "design"}])])
    await exec_svc.cancel_my_request(
        sess, executive_id=USER, tenant_id=TENANT, request_id=REQ_ID,
    )
    sql = sess.executed[0]
    assert "status = 'cancelled'" in sql
    assert "executive_id = :eid" in sql
    assert "status = 'pending'" in sql
    assert _audits(sess) == ["executive_module_access_cancelled"]


@pytest.mark.asyncio
async def test_cancelling_someone_elses_or_a_decided_row_records_nothing():
    sess = RecordingSession(results=[FakeResult(mappings_rows=[])])
    await exec_svc.cancel_my_request(
        sess, executive_id=USER, tenant_id=TENANT, request_id=REQ_ID,
    )
    assert sess.added == []


# ── decisions ────────────────────────────────────────────────────────────────

def _decided_row() -> FakeResult:
    return FakeResult(mappings_rows=[{
        "executive_id": USER, "module": "design", "target_supervisor_id": SUPERVISOR,
    }])


@pytest.mark.asyncio
async def test_approval_notifies_the_requester_and_the_chosen_supervisor():
    sess = RecordingSession(results=[_decided_row()])
    await exec_svc.approve_request(sess, TENANT, REQ_ID, "admin-1", "The Admin")
    assert _audits(sess) == ["executive_module_access_approved"]
    assert _notifications(sess) == [
        ("executive_module_access_approved", USER),
        ("executive_module_access_joined_team", SUPERVISOR),
    ]


@pytest.mark.asyncio
async def test_rejection_notifies_only_the_requester():
    sess = RecordingSession(results=[_decided_row()])
    await exec_svc.reject_request(sess, TENANT, REQ_ID, "admin-1")
    assert _notifications(sess) == [("executive_module_access_rejected", USER)]


@pytest.mark.asyncio
async def test_approval_requires_both_people_to_still_be_eligible():
    sess = RecordingSession(results=[FakeResult(mappings_rows=[])])
    await exec_svc.approve_request(sess, TENANT, REQ_ID, "admin-1")
    sql = _sql_containing(sess, "UPDATE executive_module_access_grants")
    assert "u.role = 'executive' AND u.is_active" in sql
    assert "s.role = 'supervisor' AND s.is_active" in sql
    assert "m.module = g.module" in sql


@pytest.mark.asyncio
async def test_rejection_stays_possible_whatever_became_of_either_person():
    sess = RecordingSession(results=[FakeResult(mappings_rows=[])])
    await exec_svc.reject_request(sess, TENANT, REQ_ID, "admin-1")
    sql = _sql_containing(sess, "UPDATE executive_module_access_grants")
    assert "u.role = 'executive'" not in sql
    assert "s.role = 'supervisor'" not in sql


@pytest.mark.asyncio
async def test_a_replayed_decision_records_and_notifies_nothing():
    for fn in (exec_svc.approve_request, exec_svc.reject_request, exec_svc.revoke_grant):
        sess = RecordingSession(results=[FakeResult(mappings_rows=[])])
        await fn(sess, TENANT, REQ_ID, "admin-1")
        assert sess.added == []


@pytest.mark.asyncio
async def test_a_malformed_id_is_a_no_op_rather_than_a_500():
    for fn in (exec_svc.approve_request, exec_svc.reject_request, exec_svc.revoke_grant):
        sess = RecordingSession()
        await fn(sess, TENANT, "not-a-uuid", "admin-1")
        assert sess.executed == []
    sess = RecordingSession()
    await exec_svc.cancel_my_request(
        sess, executive_id=USER, tenant_id=TENANT, request_id="not-a-uuid",
    )
    assert sess.executed == []


@pytest.mark.asyncio
async def test_revoke_also_ends_the_executives_delegations_in_that_module():
    sess = RecordingSession(results=[
        FakeResult(mappings_rows=[{"executive_id": USER, "module": "design"}]),
    ])
    await exec_svc.revoke_grant(sess, TENANT, GRANT_ID, "admin-1")
    grant_sql = sess.executed[0]
    assert "status = 'revoked'" in grant_sql
    assert "AND status = 'approved'" in grant_sql
    delegations_sql = _sql_containing(sess, "UPDATE site_delegations")
    assert "delegate_user_id = :eid" in delegations_sql
    assert "module = :m" in delegations_sql
    assert "revoked_at IS NULL" in delegations_sql
    assert sess.execute_params[1]["m"] == "design"
    assert _audits(sess) == ["executive_module_access_revoked"]
    assert _notifications(sess) == [("executive_module_access_revoked", USER)]


# ── the executive's panel ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_panel_lists_states_without_nso():
    row = {"created_at": None, "decided_at": None, "supervisor_name": "Meera"}
    sess = RecordingSession(results=[FakeResult(mappings_rows=[
        {**row, "id": GRANT_ID, "module": "design", "status": "approved",
         "target_supervisor_id": SUPERVISOR},
        {**row, "id": REQ_ID, "module": "bd", "status": "pending",
         "target_supervisor_id": SUPERVISOR},
        {**row, "id": REQ_ID, "module": "project", "status": "cancelled",
         "target_supervisor_id": SUPERVISOR},
    ])])
    rows = await exec_svc.list_my_access(
        sess, executive_id=USER, tenant_id=TENANT, home_module="legal",
    )
    by_module = {r["module"]: r for r in rows}
    assert "nso" not in by_module
    assert by_module["legal"]["state"] == "home"
    assert by_module["design"]["state"] == "granted"
    assert by_module["design"]["supervisor_name"] == "Meera"
    assert by_module["bd"]["state"] == "pending"
    assert by_module["bd"]["request_id"] == REQ_ID
    assert by_module["project"]["state"] == "none"
    assert by_module["project"]["last_decision"] == "cancelled"
    assert by_module["project"]["request_id"] is None


# ── the chosen supervisor's team ─────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_team_includes_executives_working_here_on_a_grant():
    sess = RecordingSession(results=[
        FakeResult(all_rows=[(1,)]),   # _assert_supervises_module
        FakeResult(mappings_rows=[{
            "id": USER, "email": "ravi@example.com", "name": "Ravi",
            "joined_at": None, "borrowed": True, "home_module": "legal",
        }]),
    ])
    user = {"sub": SUPERVISOR, "tenant_id": TENANT, "real_role": "supervisor"}
    team = await codes_svc.list_my_team(sess, user, "design")
    sql = sess.executed[1]
    assert "UNION ALL" in sql
    assert "executive_module_access_grants" in sql
    assert "g.target_supervisor_id = CAST(:sid AS uuid)" in sql
    assert "g.status = 'approved'" in sql
    assert team[0]["borrowed"] is True
    assert team[0]["home_module"] == "legal"


# ── the migration ────────────────────────────────────────────────────────────

def _migration_sql() -> str:
    path = (
        Path(__file__).resolve().parents[1]
        / "database" / "migrations" / "20261022_executive_module_access_grants.sql"
    )
    return path.read_text()


def test_the_migration_parses_as_whole_statements():
    from app.main import _parse_sql_statements

    statements = _parse_sql_statements(_migration_sql())
    do_blocks = [s for s in statements if s.strip().startswith("DO $$")]
    assert len(do_blocks) == 1
    assert "END $$" in do_blocks[0]


def test_the_migration_excludes_nso_and_keys_one_live_row_per_module():
    body = "\n".join(
        line for line in _migration_sql().splitlines() if not line.lstrip().startswith("--")
    )
    assert "'nso'" not in body
    assert "uq_emag_executive_module_live" in body
    assert "(executive_id, module)" in body
    assert "WHERE status IN ('pending', 'approved')" in body
    assert "pg_policy" not in body
