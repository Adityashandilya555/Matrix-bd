"""Supervisor cross-module workspace access (migration 20260930).

A supervisor of one module may be granted supervisor access to another. The
grant is a simulation, never a membership — no user_module_memberships row is
written, because one would silently relocate them at their next login (the
`ORDER BY module ... LIMIT 1` in auth_repo.get_primary_membership).

Like tests/test_observer_override.py, the claim-rewrite half drives the real
``get_current_user`` against the RecordingSession stand-in: the branch IS a
claim rewrite, and asserting it any other way would just re-implement it here.
"""
from __future__ import annotations

import inspect
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core import deps
from app.core.security import issue_token
from app.services import module_access_service as access_svc
from app.services import supervisor_code_service as codes_svc

from tests.conftest import FakeResult, RecordingSession

TENANT = "00000000-0000-0000-0000-0000000000aa"
USER = "00000000-0000-0000-0000-0000000000bb"


class _Req:
    """Only ``.method`` and ``.url.path`` are read by get_current_user."""

    def __init__(self, method: str = "GET", path: str = "/api/sites") -> None:
        self.method = method
        self.url = SimpleNamespace(path=path)


def _token(module: str | None = "bd") -> str:
    return issue_token(
        sub=USER, email="asha@example.com", name="Asha",
        role="supervisor", tenant_id=TENANT, city="Gurugram", module=module,
    )


def _session(*, has_exec: bool = False, grant: bool = False) -> RecordingSession:
    """A session whose one queued result is the is_active / role / grant SELECT."""
    return RecordingSession(results=[FakeResult(mappings_rows=[{
        "role": "supervisor",
        "is_active": True,
        "has_executive_access": has_exec,
        "has_pending_executive_request": False,
        "has_module_grant": grant,
    }])])


async def _resolve(
    *, grant: bool = False, has_exec: bool = False,
    override_role: str | None = None, override_module: str | None = None,
    method: str = "GET", path: str = "/api/sites",
    db: RecordingSession | None = None,
) -> dict:
    return await deps.get_current_user(
        _Req(method, path),
        db if db is not None else _session(has_exec=has_exec, grant=grant),
        authorization=f"Bearer {_token()}",
        x_override_role=override_role,
        x_override_module=override_module,
    )


# ── entering a borrowed module ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_a_supervisor_with_an_approved_grant_enters_the_other_module():
    claims = await _resolve(grant=True, override_role="supervisor", override_module="legal")
    assert claims["module"] == "legal"
    assert claims["role"] == "supervisor"
    assert claims["borrowed_module"] == "legal"


@pytest.mark.asyncio
async def test_a_grant_cannot_make_the_caller_an_executive_in_the_borrowed_module():
    """The borrowed branch never reads X-Override-Role.

    has_executive_access is a fact about the caller's OWN module, so honouring
    an executive override inside a borrowed one would hand out an identity
    nobody approved. Before 20260930 this returned role=executive scoped to the
    caller's own module — the flag read for one module, applied to another.
    """
    claims = await _resolve(
        grant=True, has_exec=True, override_role="executive", override_module="legal",
    )
    assert claims["role"] == "supervisor"
    assert claims["module"] == "legal"


@pytest.mark.asyncio
async def test_a_supervisor_without_a_grant_is_refused_rather_than_ignored():
    """Silently dropping the header is unsafe, not merely unhelpful: the request
    would run against the caller's own module while the client believed it was
    in Legal, and the BD routes carry no module guard to catch the difference."""
    with pytest.raises(HTTPException) as exc:
        await _resolve(override_role="supervisor", override_module="legal")
    assert exc.value.status_code == 403
    assert "legal" in exc.value.detail


@pytest.mark.asyncio
async def test_the_home_module_claim_survives_the_override():
    claims = await _resolve(grant=True, override_role="supervisor", override_module="legal")
    assert claims["home_module"] == "bd"


@pytest.mark.asyncio
async def test_own_module_facts_are_computed_for_the_callers_own_module():
    """:own and :mod are separate bind params on purpose — the membership join
    and the executive-request probe must not follow the borrowed module."""
    db = _session(has_exec=True, grant=True)
    await _resolve(db=db, override_role="supervisor", override_module="legal")
    params = db.execute_params[0]
    assert params["own"] == "bd"
    assert params["mod"] == "legal"


@pytest.mark.asyncio
async def test_whoami_is_exempt_so_a_stale_override_does_not_sign_the_user_out():
    """SessionContext treats a 403 from whoami as an auth rejection and clears
    the token on first load. A revoked grant must drop the override, not end the
    session — so the refusal is reported in the claims there instead."""
    claims = await _resolve(override_module="legal", path="/api/auth/whoami")
    assert claims["workspace_access_refused"] == "legal"
    assert claims["module"] == "bd"
    assert deps._OVERRIDE_REFUSED not in claims


# ── locks: behaviour that must not move ──────────────────────────────────────

@pytest.mark.asyncio
async def test_the_dual_role_switch_inside_my_own_module_is_unchanged():
    claims = await _resolve(has_exec=True, override_role="executive", override_module="bd")
    assert claims["role"] == "executive"
    assert claims["module"] == "bd"
    assert "borrowed_module" not in claims


@pytest.mark.asyncio
async def test_a_grant_never_reaches_real_role():
    claims = await _resolve(grant=True, override_role="supervisor", override_module="legal")
    assert claims["real_role"] == "supervisor"


def test_the_refusal_is_raised_after_the_rollback():
    """#103: the membership SELECT autobegins a transaction. Raising before it is
    released leaves it open, and every later write lands in a savepoint that is
    never committed."""
    src = inspect.getsource(deps.get_current_user)
    assert src.index("await db.rollback()") < src.index("_assert_workspace_access(")


# ── module authority ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_authority_helper_accepts_a_grant_as_well_as_a_membership():
    sess = RecordingSession(results=[FakeResult(all_rows=[(1,)])])
    await codes_svc._assert_supervises_module(
        sess, supervisor_id="s", module="legal", tenant_id="t",
    )
    sql = sess.executed[0]
    assert "user_module_memberships" in sql
    assert "supervisor_module_access_grants" in sql
    assert "status = 'approved'" in sql


@pytest.mark.asyncio
async def test_rotating_another_modules_invite_code_now_requires_authority():
    """Without this, revoking a grant would not stop the ex-borrower minting
    fresh invite codes for that module and recruiting into it indefinitely."""
    sess = RecordingSession(results=[FakeResult(all_rows=[])])
    with pytest.raises(HTTPException) as exc:
        await codes_svc.rotate_my_code(sess, "t", "s", "legal")
    assert exc.value.status_code == 403
    assert not any("INSERT" in s for s in sess.executed)


@pytest.mark.asyncio
async def test_reading_another_modules_invite_code_now_requires_authority():
    sess = RecordingSession(results=[FakeResult(all_rows=[])])
    with pytest.raises(HTTPException) as exc:
        await codes_svc.get_my_code(sess, "s", "legal", "t")
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_approving_a_pending_exec_checks_module_authority():
    sess = RecordingSession(results=[FakeResult(all_rows=[])])
    with pytest.raises(HTTPException) as exc:
        await codes_svc.approve_my_pending_exec(
            sess, tenant_id="t", supervisor_id="s", user_id="u", module="legal",
        )
    assert exc.value.status_code == 403
    assert not any("UPDATE users" in s for s in sess.executed)


# ── the grant lifecycle ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_requesting_your_own_module_is_refused():
    sess = RecordingSession()
    with pytest.raises(HTTPException) as exc:
        await access_svc.request_module_access(
            sess, supervisor_id="s", tenant_id="t", home_module="bd", module="bd",
        )
    assert exc.value.status_code == 400
    assert sess.executed == []


@pytest.mark.asyncio
async def test_requesting_a_module_you_already_hold_is_refused():
    sess = RecordingSession(results=[FakeResult(all_rows=[(1,)])])
    with pytest.raises(HTTPException) as exc:
        await access_svc.request_module_access(
            sess, supervisor_id="s", tenant_id="t", home_module="bd", module="legal",
        )
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_the_request_insert_infers_the_partial_index():
    """The index predicate has to be restated verbatim or Postgres cannot target
    uq_smag_supervisor_module_live — the lesson from migration 20260818."""
    sess = RecordingSession(results=[
        FakeResult(all_rows=[]),
        FakeResult(mappings_rows=[{"id": "11111111-1111-1111-1111-111111111111"}]),
    ])
    await access_svc.request_module_access(
        sess, supervisor_id="s", tenant_id="t", home_module="bd", module="legal",
    )
    insert_sql = next(s for s in sess.executed if "INSERT INTO supervisor_module_access_grants" in s)
    assert "ON CONFLICT (supervisor_id, module)" in insert_sql
    assert "WHERE status IN ('pending', 'approved') DO NOTHING" in insert_sql


@pytest.mark.asyncio
async def test_a_duplicate_request_is_a_no_op_and_is_not_audited():
    sess = RecordingSession(results=[
        FakeResult(all_rows=[]),
        FakeResult(mappings_rows=[]),   # ON CONFLICT swallowed the insert
    ])
    await access_svc.request_module_access(
        sess, supervisor_id="s", tenant_id="t", home_module="bd", module="legal",
    )
    assert sess.added == []


@pytest.mark.asyncio
async def test_the_lifecycle_is_audited():
    sess = RecordingSession(results=[
        FakeResult(all_rows=[]),
        FakeResult(mappings_rows=[{"id": "11111111-1111-1111-1111-111111111111"}]),
    ])
    await access_svc.request_module_access(
        sess, supervisor_id="s", tenant_id="t", home_module="bd", module="legal",
    )
    assert [a.action for a in sess.added] == ["module_access_requested"]

    for fn, action in (
        (access_svc.approve_request, "module_access_approved"),
        (access_svc.reject_request, "module_access_rejected"),
        (access_svc.revoke_grant, "module_access_revoked"),
    ):
        s = RecordingSession(results=[
            FakeResult(mappings_rows=[{"supervisor_id": "s", "module": "legal"}]),
        ])
        await fn(s, "t", "req-1", "admin-1", "The Admin")
        assert [a.action for a in s.added] == [action]


@pytest.mark.asyncio
async def test_a_replayed_decision_writes_no_audit_row():
    """The guarded UPDATE's `AND status = '<expected>'` IS the idempotency, so a
    double-click must record nothing rather than a second event."""
    for fn in (access_svc.approve_request, access_svc.reject_request, access_svc.revoke_grant):
        sess = RecordingSession(results=[FakeResult(mappings_rows=[])])
        await fn(sess, "t", "req-1", "admin-1", "The Admin")
        assert sess.added == []


@pytest.mark.asyncio
async def test_revoke_only_touches_an_approved_grant():
    sess = RecordingSession(results=[FakeResult(mappings_rows=[])])
    await access_svc.revoke_grant(sess, "t", "grant-1", "admin-1")
    sql = sess.executed[0]
    assert "status = 'revoked'" in sql
    assert "AND status = 'approved'" in sql
    assert "revoked_at = now()" in sql


@pytest.mark.asyncio
async def test_the_decision_status_is_bound_not_interpolated():
    sess = RecordingSession(results=[FakeResult(mappings_rows=[])])
    await access_svc.approve_request(sess, "t", "req-1", "admin-1")
    assert "SET status = :new_status" in sess.executed[0]
    assert sess.execute_params[0]["new_status"] == "approved"


@pytest.mark.asyncio
async def test_the_access_page_marks_the_home_module_and_a_live_grant():
    sess = RecordingSession(results=[FakeResult(mappings_rows=[
        {"module": "legal", "status": "approved", "created_at": None, "decided_at": None},
        {"module": "design", "status": "rejected", "created_at": None, "decided_at": None},
    ])])
    rows = await access_svc.list_my_module_access(
        sess, supervisor_id="s", tenant_id="t", home_module="bd",
    )
    by_module = {r["module"]: r for r in rows}
    assert by_module["bd"]["state"] == "home"
    assert by_module["legal"]["state"] == "granted"
    assert by_module["design"]["state"] == "none"
    assert by_module["design"]["last_decision"] == "rejected"
    assert by_module["nso"]["state"] == "none"


# ── the migration ────────────────────────────────────────────────────────────

def _migration_sql() -> str:
    from pathlib import Path
    path = (
        Path(__file__).resolve().parents[1]
        / "database" / "migrations" / "20260930_supervisor_module_access_grants.sql"
    )
    return path.read_text()


def test_the_grant_migration_parses_as_whole_statements():
    """The runner splits on semicolons and a DO block is full of them; its
    dollar-quote scanner only recognises `$$`. 20260814/20260815 were shredded
    exactly this way."""
    from app.main import _parse_sql_statements

    statements = _parse_sql_statements(_migration_sql())
    do_blocks = [s for s in statements if s.strip().startswith("DO $$")]
    assert len(do_blocks) == 1
    assert "END $$" in do_blocks[0]


def test_the_partial_unique_index_covers_approved_too():
    """Here the row IS the grant, so two approved rows would be two live grants
    and a revoke would leave one behind."""
    sql = _migration_sql()
    assert "uq_smag_supervisor_module_live" in sql
    assert "WHERE status IN ('pending', 'approved')" in sql


def test_the_migration_does_not_query_pg_policy_columns_that_do_not_exist():
    """202606231's RLS block reads pg_policy.schemaname, which exists on the
    pg_policies VIEW, not the catalog. It was baselined rather than executed, so
    the error never surfaced — copying it would fail on every boot."""
    # Comment lines are stripped first: the header names the broken pattern in
    # order to warn the next person off it.
    body = "\n".join(
        line for line in _migration_sql().splitlines() if not line.lstrip().startswith("--")
    )
    assert "pg_policy" not in body
    assert "DROP POLICY IF EXISTS tenant_isolation" in body
