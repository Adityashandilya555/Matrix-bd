"""Role dashboards: which SQL each role sends and which sections it gets.

These run without a database (RecordingSession). test_dashboard_summary_pg.py
runs the same builders against real Postgres rows.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from app.main import ROUTERS
from app.routers import dashboard as dashboard_router
from app.routers import nso as nso_router
from app.services import dashboard_service as svc
from tests.conftest import FakeResult, RecordingSession

TID = "11111111-1111-1111-1111-111111111111"
UID = "22222222-2222-2222-2222-222222222222"
MATE = "33333333-3333-3333-3333-333333333333"


def _user(role, module=None, real_role=None):
    return {"tenant_id": TID, "sub": UID, "role": role, "real_role": real_role or role, "module": module}


def _sql(db: RecordingSession) -> list[str]:
    out = []
    for stmt in db.executed_raw:
        compiled = stmt.compile(dialect=postgresql.dialect())
        out.append(str(compiled))
    return out


def _params(db: RecordingSession) -> list[dict]:
    """Bound values per statement, whether Core (compiled) or text() (passed)."""
    out = []
    for stmt, passed in zip(db.executed_raw, db.execute_params):
        values = dict(stmt.compile(dialect=postgresql.dialect()).params)
        values.update(passed or {})
        out.append(values)
    return out


async def _run(user, scope="module", results=()):
    db = RecordingSession(list(results))
    out = await svc.build_summary(db, user, scope)
    return db, out


# ── resolve_context ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("role", ["business_admin", "observer"])
def test_admin_and_observer_are_tenant_wide(role):
    assert svc.resolve_context(_user(role), "module").kind == "admin"


def test_vendor_has_no_dashboard():
    with pytest.raises(HTTPException) as exc:
        svc.resolve_context(_user("vendor"), "module")
    assert exc.value.status_code == 403


def test_supervisor_without_a_module_is_refused():
    with pytest.raises(HTTPException):
        svc.resolve_context(_user("supervisor", None), "module")


def test_admin_simulating_an_executive_gets_the_simulated_module_view():
    ctx = svc.resolve_context(_user("executive", "design", real_role="business_admin"), "module")
    assert (ctx.kind, ctx.simulated, ctx.module) == ("supervisor", True, "design")


def test_simulated_supervisor_never_takes_the_team_scope():
    """An admin has no team of their own in the module."""
    ctx = svc.resolve_context(_user("supervisor", "bd", real_role="business_admin"), "team")
    assert ctx.scope == "module" and ctx.simulated


def test_executive_scope_param_is_ignored():
    assert svc.resolve_context(_user("executive", "bd"), "team").kind == "executive"


# ── tenant boundary ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("user,scope", [
    (_user("business_admin"), "module"),
    (_user("supervisor", "bd"), "module"),
    (_user("supervisor", "bd"), "team"),
    (_user("supervisor", "legal"), "team"),
    (_user("supervisor", "nso"), "module"),
    (_user("executive", "bd"), "module"),
    (_user("executive", "design"), "module"),
])
async def test_every_statement_is_bound_to_the_callers_tenant(user, scope):
    db, _ = await _run(user, scope)
    for sql, params in zip(_sql(db), _params(db)):
        assert "tenant_id" in sql, sql
        assert TID in {str(v) for v in params.values()}, sql


# ── executives ───────────────────────────────────────────────────────────────

async def test_bd_executive_sees_only_sites_they_submitted_or_are_assigned():
    db, out = await _run(_user("executive", "bd"))
    site_sql = [s for s in _sql(db) if "FROM sites" in s and "audit_logs" not in s and "legal_change_requests" not in s]
    assert site_sql
    for sql in site_sql:
        assert "sites.submitted_by =" in sql and "sites.assigned_to =" in sql, sql


async def test_module_executive_is_scoped_by_active_delegations_including_the_companion():
    db, _ = await _run(_user("executive", "project"))
    params = _params(db)
    site_sql = [(s, p) for s, p in zip(_sql(db), params) if "FROM sites" in s and "audit_logs" not in s
                and "legal_change_requests" not in s]
    for sql, p in site_sql:
        assert "site_delegations" in sql and "revoked_at IS NULL" in sql, sql
        modules = [v for v in p.values() if isinstance(v, list)]
        assert ["project", "financial_closure"] in modules, sql


async def test_executive_activity_is_their_own_actions_only():
    db, _ = await _run(_user("executive", "bd"))
    activity = next(s for s in _sql(db) if "audit_logs" in s)
    assert "audit_logs.actor_id =" in activity


@pytest.mark.parametrize("module", ["bd", "legal", "design", "nso"])
async def test_executive_payload_never_has_money_people_or_queues(module):
    _, out = await _run(_user("executive", module))
    assert not {"money", "people", "workload", "modules", "cycle_times", "launches"} & set(out)
    assert out["scope"] == "personal"


# ── supervisors ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("module", ["legal", "design", "project", "nso", "project_excellence"])
async def test_non_bd_supervisor_gets_no_bd_funnel_or_cycle_times(module):
    _, out = await _run(_user("supervisor", module))
    assert "cycle_times" not in out and "money" not in out and "people" not in out
    assert out["funnel"]["module"] == module


async def test_team_scope_reads_distinct_members_bound_by_tenant_and_module():
    team_rows = FakeResult(all_rows=[(MATE,), (UID,)])
    db, out = await _run(_user("supervisor", "bd"), "team", results=[team_rows])
    first = db.executed[0]
    assert "SELECT DISTINCT" in first and "m.tenant_id = :tid" in first and "g.tenant_id = :tid" in first
    assert db.execute_params[0] == {"tid": TID, "mod": "bd", "uid": UID}
    assert out["scope"] == "team"
    # The caller is never counted as their own team member.
    assert next(t for t in out["kpis"]["tiles"] if t["key"] == "team")["value"] == 1


async def test_bd_team_scope_filters_sites_by_team_or_supervisor_id():
    db, _ = await _run(_user("supervisor", "bd"), "team", results=[FakeResult(all_rows=[(MATE,)])])
    kpi_sql = _sql(db)[1]
    assert "sites.submitted_by IN" in kpi_sql and "sites.supervisor_id =" in kpi_sql


async def test_module_team_scope_goes_through_delegations():
    db, _ = await _run(_user("supervisor", "legal"), "team", results=[FakeResult(all_rows=[(MATE,)])])
    kpi_sql = _sql(db)[1]
    assert "site_delegations" in kpi_sql and "granted_by" in kpi_sql and "legal_review_at IS NOT NULL" in kpi_sql


async def test_module_scope_does_not_load_a_team():
    db, _ = await _run(_user("supervisor", "bd"))
    assert not any("user_module_memberships" in s for s in db.executed)


# ── admin ────────────────────────────────────────────────────────────────────

async def test_admin_payload_has_every_section():
    _, out = await _run(_user("business_admin"))
    assert {"kpis", "inbox", "launches", "funnel", "modules", "cycle_times", "cities", "compliance",
            "money", "people", "workload", "activity"} <= set(out)
    assert out["role"] == "admin" and out["scope"] == "tenant" and out["module"] is None


async def test_admin_tiles_keep_the_labels_the_existing_ui_tests_use():
    _, out = await _run(_user("business_admin"))
    labels = {t["label"] for t in out["kpis"]["tiles"]}
    assert "Completed sites" in labels


async def test_every_section_carries_source_and_as_of():
    _, out = await _run(_user("business_admin"))
    for key, section in out.items():
        if isinstance(section, dict):
            assert "source" in section and "as_of" in section, key


# ── version ──────────────────────────────────────────────────────────────────

async def test_version_is_one_statement_and_stable():
    row = FakeResult(all_rows=[("2026-11-21", 4)])
    row.first = lambda: ("2026-11-21", 4)  # type: ignore[method-assign]
    db = RecordingSession([row, row])
    v1 = await svc.get_version(db, TID)
    assert len(db.executed) == 1 and "tenant_id = :tid" in db.executed[0]
    assert v1 == await svc.get_version(db, TID)
    assert len(v1) == 16


def test_etag_matching():
    v = "abc123"
    assert svc.etag_matches('"abc123"', v)
    assert svc.etag_matches('W/"abc123", "zzz"', v)
    assert svc.etag_matches("*", v)
    assert not svc.etag_matches('"other"', v)
    assert not svc.etag_matches(None, v)


async def test_version_route_answers_304_on_a_matching_etag(monkeypatch):
    async def fake_version(_db, _tid):
        return "abc123"
    monkeypatch.setattr(svc, "get_version", fake_version)
    from fastapi import Response
    resp = await dashboard_router.dashboard_version(Response(), None, {}, TID, if_none_match='"abc123"')
    assert resp.status_code == 304 and resp.headers["ETag"] == '"abc123"'
    fresh_resp = Response()
    body = await dashboard_router.dashboard_version(fresh_resp, None, {}, TID, if_none_match='"old"')
    assert body["version"] == "abc123" and fresh_resp.headers["ETag"] == '"abc123"'


# ── routing ──────────────────────────────────────────────────────────────────

# Inspect the router objects, not app.routes: see the note in
# test_observer_readonly.py about the assembled app's routes in CI.

def test_dashboard_router_is_registered_with_its_routes():
    assert dashboard_router in ROUTERS
    paths = {r.path for r in dashboard_router.router.routes}
    assert paths == {"/dashboard/version", "/dashboard/summary"}


def test_nso_summary_is_declared_before_the_site_id_route():
    paths = [r.path for r in nso_router.router.routes]
    assert paths.index("/nso/summary") < paths.index("/nso/{site_id}")


async def test_nso_summary_is_the_supervisor_view_for_an_nso_grant_executive():
    """deps elevates an NSO-grant executive to supervisor on /api/nso/* only."""
    db = RecordingSession()
    out = await svc.build_nso_summary(db, _user("supervisor", "nso", real_role="executive"))
    assert (out["role"], out["module"], out["simulated"]) == ("supervisor", "nso", False)


async def test_dashboard_summary_does_not_elevate_an_nso_grant_executive():
    """On /api/dashboard the same person is still an executive."""
    _, out = await _run(_user("executive", "nso"))
    assert out["role"] == "executive" and "workload" not in out
