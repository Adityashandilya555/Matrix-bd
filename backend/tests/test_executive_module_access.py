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


@pytest.mark.asyncio
async def test_a_grant_whose_supervisor_is_gone_or_inactive_no_longer_admits():
    """target_supervisor_id is ON DELETE SET NULL, and a deactivated supervisor
    has no reachable Team page; either way the row names nobody to report to,
    so the probe must require an active supervisor (a NULL id matches none)."""
    db = _session(grant=True)
    await _resolve(db=db, override_module="design")
    sql = db.executed[0]
    assert "ts.id = eg.target_supervisor_id" in sql
    assert "ts.role = 'supervisor' AND ts.is_active" in sql


# ── the request ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("module,sid", [
    ("legal", SUPERVISOR),   # the home module
    ("nso", SUPERVISOR),     # NSO supervisor access names no supervisor
    ("nso", ""),             # not even an empty one, which would reach the CAST
    ("design", None),        # every other module requires one
])
async def test_bad_requests_are_refused_before_any_sql(module, sid):
    sess = RecordingSession()
    with pytest.raises(HTTPException) as exc:
        await exec_svc.request_access(
            sess, executive_id=USER, tenant_id=TENANT, home_module="legal",
            module=module, target_supervisor_id=sid,
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
    sess = RecordingSession(results=[FakeResult(mappings_rows=[]), FakeResult(all_rows=[])])
    with pytest.raises(HTTPException) as exc:
        await exec_svc.request_access(
            sess, executive_id=USER, tenant_id=TENANT, home_module="legal",
            module="design", target_supervisor_id=SUPERVISOR,
        )
    assert exc.value.status_code == 400
    assert not any("INSERT" in s for s in sess.executed)
    check = sess.executed[1]
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
        FakeResult(mappings_rows=[]),   # no membership in the module
        FakeResult(all_rows=[(1,)]),
        FakeResult(mappings_rows=[]),   # nothing orphaned to sweep
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
        FakeResult(mappings_rows=[]),   # no membership in the module
        FakeResult(all_rows=[(1,)]),
        FakeResult(mappings_rows=[]),   # nothing orphaned to sweep
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


@pytest.mark.asyncio
@pytest.mark.parametrize("module,companion", [
    ("project", "financial_closure"),
    ("project_excellence", "quality_audit"),
    ("design", None),
])
async def test_revoke_also_ends_the_companion_module_delegations(module, companion):
    """Financial Closure is delegated within Project, the QA-report task within
    Project Excellence, under their own site_delegations module — and the FC
    queue has no module gate, so a leftover row would keep being read."""
    sess = RecordingSession(results=[
        FakeResult(mappings_rows=[{"executive_id": USER, "module": module}]),
    ])
    await exec_svc.revoke_grant(sess, TENANT, GRANT_ID, "admin-1")
    delegations_sql = _sql_containing(sess, "UPDATE site_delegations")
    assert "(module = :m OR module = :companion)" in delegations_sql
    assert sess.execute_params[1]["m"] == module
    assert sess.execute_params[1]["companion"] == companion


# ── the executive's panel ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_panel_lists_states():
    row = {"created_at": None, "decided_at": None, "supervisor_name": "Meera",
           "supervisor_active": True}
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
    assert by_module["nso"]["state"] == "none"
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


@pytest.mark.asyncio
async def test_the_admin_team_view_skips_grants_whose_supervisor_was_deleted():
    sess = RecordingSession(results=[FakeResult(mappings_rows=[])])
    user = {"sub": "admin-1", "tenant_id": TENANT, "real_role": "business_admin"}
    await codes_svc.list_my_team(sess, user, "design")
    assert "ts.id = g.target_supervisor_id" in sess.executed[0]
    assert "ts.role = 'supervisor' AND ts.is_active" in sess.executed[0]


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


# ── the reporting line going away (supervisor deactivated or deleted) ─────────

@pytest.mark.asyncio
async def test_deactivating_a_supervisor_ends_their_grants_and_closes_requests():
    sess = RecordingSession(results=[
        FakeResult(mappings_rows=[{"id": GRANT_ID, "executive_id": USER, "module": "design"}]),
        FakeResult(),   # site_delegations UPDATE
        FakeResult(mappings_rows=[{"id": REQ_ID, "executive_id": USER, "module": "bd"}]),
    ])
    await exec_svc.revoke_grants_for_supervisor(
        sess, tenant_id=TENANT, supervisor_id=SUPERVISOR, actor_id="admin-1",
    )
    revoke_sql = sess.executed[0]
    assert "status = 'revoked'" in revoke_sql
    assert "g.target_supervisor_id = CAST(:sid AS uuid)" in revoke_sql
    assert "g.status = 'approved'" in revoke_sql
    assert "UPDATE site_delegations" in sess.executed[1]
    reject_sql = sess.executed[2]
    assert "status = 'rejected'" in reject_sql
    assert "g.status = 'pending'" in reject_sql
    assert _audits(sess) == [
        "executive_module_access_auto_revoked", "executive_module_access_auto_rejected",
    ]
    assert _notifications(sess) == [
        ("executive_module_access_revoked", USER),
        ("executive_module_access_rejected", USER),
    ]


@pytest.mark.asyncio
async def test_deactivate_org_user_revokes_grants_naming_a_supervisor():
    from app.services import business_admin_service as ba_svc

    sess = RecordingSession(results=[
        FakeResult(mappings_rows=[{"is_active": True, "role": "supervisor"}]),
        FakeResult(),   # UPDATE users
        FakeResult(mappings_rows=[]),   # no approved grants
        FakeResult(mappings_rows=[]),   # no pending requests
    ])
    await ba_svc.deactivate_org_user(sess, TENANT, SUPERVISOR, {"sub": "admin-1"})
    _sql_containing(sess, "UPDATE executive_module_access_grants AS g")
    assert sess.execute_params[2]["sid"] == SUPERVISOR


@pytest.mark.asyncio
async def test_deactivating_an_executive_touches_no_grants():
    from app.services import business_admin_service as ba_svc

    sess = RecordingSession(results=[
        FakeResult(mappings_rows=[{"is_active": True, "role": "executive"}]),
    ])
    await ba_svc.deactivate_org_user(sess, TENANT, USER, {"sub": "admin-1"})
    assert not any("executive_module_access_grants" in q for q in sess.executed)


@pytest.mark.asyncio
async def test_a_request_first_sweeps_an_orphaned_live_row_so_it_can_be_refiled():
    """Without the sweep, a grant whose supervisor was deleted keeps the live
    row and every new request is a 409 forever."""
    sess = RecordingSession(results=[
        FakeResult(mappings_rows=[]),   # no membership in the module
        FakeResult(all_rows=[(1,)]),
        FakeResult(mappings_rows=[{"id": GRANT_ID, "executive_id": USER,
                                   "module": "design", "status": "revoked"}]),
        FakeResult(),   # site_delegations UPDATE for the swept grant
        FakeResult(mappings_rows=[{"id": REQ_ID}]),
        FakeResult(scalars_list=[]),
    ])
    await exec_svc.request_access(
        sess, executive_id=USER, tenant_id=TENANT, home_module="legal",
        module="design", target_supervisor_id=SUPERVISOR,
    )
    sweep_sql = sess.executed[2]
    assert "g.status IN ('pending', 'approved')" in sweep_sql
    assert "NOT EXISTS (SELECT 1 FROM users s" in sweep_sql
    order = [q for q in sess.executed if "executive_module_access_grants" in q]
    assert "INSERT" in order[-1]
    assert _audits(sess) == [
        "executive_module_access_auto_revoked", "executive_module_access_requested",
    ]


@pytest.mark.asyncio
async def test_the_panel_reads_an_orphaned_grant_as_requestable():
    base = {"created_at": None, "decided_at": None, "supervisor_name": None,
            "target_supervisor_id": None, "supervisor_active": None}
    sess = RecordingSession(results=[FakeResult(mappings_rows=[
        {**base, "id": GRANT_ID, "module": "design", "status": "approved"},
        {**base, "id": REQ_ID, "module": "bd", "status": "pending",
         "target_supervisor_id": SUPERVISOR, "supervisor_active": False},
    ])])
    rows = await exec_svc.list_my_access(
        sess, executive_id=USER, tenant_id=TENANT, home_module="legal",
    )
    by_module = {r["module"]: r for r in rows}
    assert by_module["design"]["state"] == "none"
    assert by_module["design"]["last_decision"] == "revoked"
    assert by_module["design"]["request_id"] is None
    assert by_module["bd"]["state"] == "none"
    assert by_module["bd"]["last_decision"] == "rejected"


@pytest.mark.asyncio
async def test_a_module_the_executive_already_belongs_to_is_refused():
    """Nothing stops an executive holding membership rows in two modules; a
    grant into the second would list them twice on that supervisor's team."""
    sess = RecordingSession(results=[FakeResult(mappings_rows=[{"module": "design"}])])
    with pytest.raises(HTTPException) as exc:
        await exec_svc.request_access(
            sess, executive_id=USER, tenant_id=TENANT, home_module="legal",
            module="design", target_supervisor_id=SUPERVISOR,
        )
    assert exc.value.status_code == 400
    assert not any("INSERT" in q for q in sess.executed)


@pytest.mark.asyncio
async def test_the_panel_marks_every_module_the_executive_belongs_to():
    sess = RecordingSession(results=[
        FakeResult(mappings_rows=[]),
        FakeResult(mappings_rows=[{"module": "legal"}, {"module": "project"}]),
    ])
    rows = await exec_svc.list_my_access(
        sess, executive_id=USER, tenant_id=TENANT, home_module="legal",
    )
    by_module = {r["module"]: r["state"] for r in rows}
    assert by_module["legal"] == "home"
    assert by_module["project"] == "home"
    assert by_module["design"] == "none"


# ── NSO supervisor access (migration 20261023) ───────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("path", ["/api/nso/queue", "/api/nso/site-1/final-approval", "/api/nso"])
async def test_an_nso_grant_makes_the_executive_a_supervisor_on_nso_routes(path):
    claims = await _resolve(grant=True, override_module="nso", path=path)
    assert claims["role"] == "supervisor"
    assert claims["module"] == "nso"
    assert claims["real_role"] == "executive"


@pytest.mark.asyncio
@pytest.mark.parametrize("path", [
    "/api/sites", "/api/bd/sites/x/approve", "/api/supervisor-codes/me/nso/team",
    "/api/nsofoo", "/nso/queue", "/api/auth/whoami",
])
async def test_the_nso_supervisor_role_never_leaves_the_nso_router(path):
    """The BD routes carry no module guard, so a supervisor role applied to the
    whole borrowed session would reach BD's supervisor-only actions."""
    claims = await _resolve(grant=True, override_module="nso", path=path)
    assert claims["role"] == "executive"
    assert claims["module"] == "nso"


@pytest.mark.asyncio
async def test_another_modules_grant_never_makes_a_supervisor():
    claims = await _resolve(grant=True, override_module="design", path="/api/nso/queue")
    assert claims["role"] == "executive"


@pytest.mark.asyncio
async def test_an_executive_without_an_nso_grant_is_still_refused():
    with pytest.raises(HTTPException) as exc:
        await _resolve(grant=False, override_module="nso", path="/api/nso/queue")
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_the_nso_router_admits_the_elevated_executive():
    from app.routers import nso

    guard = nso.NsoMember.__metadata__[0].dependency
    claims = await _resolve(grant=True, override_module="nso", path="/api/nso/queue")
    assert (await guard(current_user=claims))["role"] == "supervisor"


@pytest.mark.asyncio
async def test_the_nso_grant_probe_does_not_require_a_chosen_supervisor():
    db = _session(grant=True)
    await _resolve(db=db, override_module="nso", path="/api/nso/queue")
    assert "eg.module = 'nso' OR EXISTS" in db.executed[0]


@pytest.mark.asyncio
async def test_an_nso_request_names_no_supervisor_and_skips_the_checks():
    sess = RecordingSession(results=[
        FakeResult(mappings_rows=[]),            # no membership in NSO
        FakeResult(mappings_rows=[{"id": REQ_ID}]),
        FakeResult(scalars_list=[]),
    ])
    await exec_svc.request_access(
        sess, executive_id=USER, tenant_id=TENANT, home_module="legal",
        module="nso", target_supervisor_id=None, actor_name="Ravi",
    )
    assert not any("role_in_module = 'supervisor'" in q for q in sess.executed)
    assert not any("NOT EXISTS (SELECT 1 FROM users s" in q for q in sess.executed)
    insert = _sql_containing(sess, "INSERT INTO executive_module_access_grants")
    assert "target_supervisor_id" in insert
    params = sess.execute_params[sess.executed.index(insert)]
    assert params["sid"] is None
    assert _audits(sess) == ["executive_module_access_requested"]


@pytest.mark.asyncio
async def test_nso_has_no_supervisors_to_choose():
    with pytest.raises(HTTPException) as exc:
        await exec_svc.list_module_supervisors(
            RecordingSession(), tenant_id=TENANT, module="nso", home_module="legal",
        )
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_approval_exempts_nso_from_the_chosen_supervisor_check():
    sess = RecordingSession(results=[FakeResult(mappings_rows=[])])
    await exec_svc.approve_request(sess, TENANT, REQ_ID, "admin-1")
    sql = _sql_containing(sess, "UPDATE executive_module_access_grants")
    assert "g.module = 'nso'" in sql
    assert "u.role = 'executive' AND u.is_active" in sql


@pytest.mark.asyncio
async def test_an_approved_nso_grant_is_not_read_as_orphaned():
    sess = RecordingSession(results=[FakeResult(mappings_rows=[{
        "id": GRANT_ID, "module": "nso", "status": "approved",
        "created_at": None, "decided_at": None, "target_supervisor_id": None,
        "supervisor_name": None, "supervisor_active": None,
    }])])
    rows = await exec_svc.list_my_access(
        sess, executive_id=USER, tenant_id=TENANT, home_module="legal",
    )
    nso_row = {r["module"]: r for r in rows}["nso"]
    assert nso_row["state"] == "granted"
    assert nso_row["supervisor_id"] is None


def test_the_orphan_sweep_never_touches_nso():
    assert "g.module <> 'nso'" in str(exec_svc._SWEEP_ORPHANED_STMT)


def test_the_nso_migration_parses_and_allows_nso():
    from app.main import _parse_sql_statements

    path = (
        Path(__file__).resolve().parents[1]
        / "database" / "migrations" / "20261023_executive_nso_supervisor_access.sql"
    )
    statements = [s for s in _parse_sql_statements(path.read_text()) if s.strip()]
    assert len(statements) == 2
    assert "DROP CONSTRAINT IF EXISTS chk_emag_module" in statements[0]
    assert "'nso'" in statements[1]
