"""Dashboard summaries against a real Postgres (schema.sql loaded).

Skipped unless MATRIX_TEST_PG_URL points at a throwaway database built from
backend/database/schema.sql; see tests/test_nso_capture_pg.py for the docker
recipe. Never point it at a shared or production database: every test writes rows.

The RecordingSession tests in test_dashboard_summary.py check what SQL is sent;
these check that it runs and that each role's numbers are right on real rows.
"""
from __future__ import annotations

import os
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.services import dashboard_service as svc

PG_URL = os.environ.get("MATRIX_TEST_PG_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="MATRIX_TEST_PG_URL not set")


@pytest.fixture
async def engine():
    eng = create_async_engine(PG_URL, poolclass=NullPool)
    yield eng
    await eng.dispose()


@pytest.fixture
def maker(engine):
    return async_sessionmaker(engine, expire_on_commit=False)


_INSERT_TENANT = text("insert into tenants (id, name, slug, workspace_code) values (:id, 'Example Coffee Co', :slug, :code)")
_INSERT_USER = text("insert into users (id, tenant_id, email, name, role, is_active) values (:id, :t, :email, :name, :role, :active)")
_INSERT_SITE = text("""
    insert into sites (id, tenant_id, name, city, submitted_by, supervisor_id, status, area_sqft, expected_rent,
                       shortlisted_at, details_submitted_at, approved_at, legal_review_at, legal_dd_status,
                       is_launched, launched_at)
    values (:id, :t, :name, :city, :by, :sup, :status, :area, :rent,
            :shortlisted_at, :details_at, :approved_at, :legal_at, :dd, :launched, :launched_at)
""")
_INSERT_MEMBERSHIP = text("""
    insert into user_module_memberships (tenant_id, user_id, module, role_in_module, supervisor_id)
    values (:t, :u, :m, :r, :sup)
""")
_INSERT_DELEGATION = text("""
    insert into site_delegations (tenant_id, site_id, module, delegate_user_id, granted_by, revoked_at)
    values (:t, :s, :m, :u, :by, :revoked)
""")
_INSERT_APPROVAL = text("""
    insert into approvals (tenant_id, site_id, approver_id, status, loi_deadline)
    values (:t, :s, :by, 'approved', :deadline)
""")
_INSERT_NSO = text("insert into nso_reviews (site_id, tenant_id, current_stage, launch_date) values (:s, :t, :stage, :launch)")
_INSERT_AUDIT = text("insert into audit_logs (tenant_id, site_id, actor_id, action) values (:t, :s, :a, 'site_updated')")


async def _world(engine) -> dict:
    """One tenant: an admin, a BD supervisor with one executive, a stranger
    executive, a legal supervisor and a legal executive, and five sites."""
    ids = {k: uuid.uuid4() for k in (
        "tenant", "other_tenant", "admin", "bd_sup", "bd_exec", "bd_stranger", "legal_sup", "legal_exec",
        "s_draft", "s_approved", "s_legal", "s_launched", "s_stranger", "s_other_tenant",
    )}
    now = datetime.now(timezone.utc)
    t = ids["tenant"]
    async with engine.begin() as c:
        for key in ("tenant", "other_tenant"):
            tag = ids[key].hex[:10]
            await c.execute(_INSERT_TENANT, {"id": ids[key], "slug": f"ex-{tag}", "code": f"WS{tag}".upper()})
        users = (("admin", "business_admin"), ("bd_sup", "supervisor"), ("bd_exec", "executive"),
                 ("bd_stranger", "executive"), ("legal_sup", "supervisor"), ("legal_exec", "executive"))
        for key, role in users:
            await c.execute(_INSERT_USER, {"id": ids[key], "t": t, "email": f"{ids[key].hex[:12]}@example.com",
                                           "name": key, "role": role, "active": True})
        other_user = uuid.uuid4()
        await c.execute(_INSERT_USER, {"id": other_user, "t": ids["other_tenant"], "email": f"{other_user.hex[:12]}@example.com",
                                       "name": "other", "role": "executive", "active": True})
        for u, m, r, sup in ((ids["bd_sup"], "bd", "supervisor", None), (ids["bd_exec"], "bd", "executive", ids["bd_sup"]),
                             (ids["bd_stranger"], "bd", "executive", None), (ids["legal_sup"], "legal", "supervisor", None),
                             (ids["legal_exec"], "legal", "executive", ids["legal_sup"])):
            await c.execute(_INSERT_MEMBERSHIP, {"t": t, "u": u, "m": m, "r": r, "sup": sup})

        def site(key, by, status, city="Bengaluru", tenant=t, **kw):
            base = {"id": ids[key], "t": tenant, "name": key, "city": city, "by": by, "sup": None, "status": status,
                    "area": 1000, "rent": 150000, "shortlisted_at": None, "details_at": None, "approved_at": None,
                    "legal_at": None, "dd": "pending", "launched": False, "launched_at": None}
            return {**base, **kw}

        rows = [
            site("s_draft", ids["bd_exec"], "draft_submitted"),
            site("s_approved", ids["bd_exec"], "approved", shortlisted_at=now - timedelta(days=20),
                 details_at=now - timedelta(days=15), approved_at=now - timedelta(days=10)),
            site("s_legal", ids["bd_exec"], "legal_review", city="Mumbai", shortlisted_at=now - timedelta(days=40),
                 details_at=now - timedelta(days=35), approved_at=now - timedelta(days=30), legal_at=now - timedelta(days=5),
                 dd="in_review"),
            site("s_launched", ids["bd_sup"], "pushed_to_payments", sup=ids["bd_sup"], launched=True,
                 launched_at=now - timedelta(days=3), shortlisted_at=now - timedelta(days=90)),
            site("s_stranger", ids["bd_stranger"], "draft_submitted", city="Pune"),
            site("s_other_tenant", other_user, "draft_submitted", tenant=ids["other_tenant"], city="Delhi"),
        ]
        for r in rows:
            await c.execute(_INSERT_SITE, r)
        await c.execute(_INSERT_APPROVAL, {"t": t, "s": ids["s_approved"], "by": ids["bd_sup"], "deadline": date.today() - timedelta(days=1)})
        await c.execute(_INSERT_DELEGATION, {"t": t, "s": ids["s_legal"], "m": "legal", "u": ids["legal_exec"], "by": ids["legal_sup"], "revoked": None})
        # A revoked delegation never counts.
        await c.execute(_INSERT_DELEGATION, {"t": t, "s": ids["s_launched"], "m": "legal", "u": ids["legal_exec"], "by": ids["legal_sup"], "revoked": now})
        await c.execute(_INSERT_NSO, {"s": ids["s_legal"], "t": t, "stage": "stage_two", "launch": date.today() + timedelta(days=20)})
        await c.execute(_INSERT_AUDIT, {"t": t, "s": ids["s_draft"], "a": ids["bd_exec"]})
        await c.execute(_INSERT_AUDIT, {"t": t, "s": ids["s_stranger"], "a": ids["bd_stranger"]})
    return ids


def _user(ids, key, role, module=None, real_role=None):
    return {"tenant_id": str(ids["tenant"]), "sub": str(ids[key]), "role": role,
            "real_role": real_role or role, "module": module}


def _tile(payload, key):
    values = [t["value"] for t in payload["kpis"]["tiles"] if t["key"] == key]
    assert len(values) == 1, f"tile {key!r} missing"
    return values[0]


async def test_admin_sees_the_whole_tenant_and_nothing_else(engine, maker):
    ids = await _world(engine)
    async with maker() as db:
        out = await svc.build_summary(db, _user(ids, "admin", "business_admin"))
    assert out["role"] == "admin"
    assert _tile(out, "total") == 5          # the other tenant's site is excluded
    assert _tile(out, "launched") == 1
    assert {c["city"] for c in out["cities"]["items"]} == {"Bengaluru", "Mumbai", "Pune"}
    assert out["compliance"]["loi_overdue"] == 1
    assert out["launches"]["upcoming"][0]["name"] == "s_legal"
    assert {"money", "people", "inbox"} <= set(out)
    funnel = {s["key"]: s["count"] for s in out["funnel"]["steps"]}
    assert funnel["drafted"] == 5 and funnel["approved"] == 2 and funnel["launched"] == 1
    assert sum(d["count"] for d in out["activity"]["days"]) == 2


async def test_bd_executive_sees_only_their_own_sites(engine, maker):
    ids = await _world(engine)
    async with maker() as db:
        out = await svc.build_summary(db, _user(ids, "bd_exec", "executive", "bd"))
    assert out["role"] == "executive" and out["scope"] == "personal"
    assert _tile(out, "mine") == 3
    assert not {"money", "people", "workload", "modules"} & set(out)
    assert sum(d["count"] for d in out["activity"]["days"]) == 1   # only their own actions
    assert [i["name"] for i in out["compliance"]["loi_items"]] == ["s_approved"]


async def test_bd_supervisor_team_scope_narrows_to_their_executives(engine, maker):
    ids = await _world(engine)
    async with maker() as db:
        # Submitted by someone outside the team, assigned to a team executive.
        await db.execute(text(
            "insert into sites (tenant_id, name, city, submitted_by, assigned_to, status) "
            "values (:t, 's_assigned', 'Pune', :by, :to, 'shortlisted')"
        ), {"t": ids["tenant"], "by": ids["bd_stranger"], "to": ids["bd_exec"]})
        await db.commit()
        module = await svc.build_summary(db, _user(ids, "bd_sup", "supervisor", "bd"), "module")
        team = await svc.build_summary(db, _user(ids, "bd_sup", "supervisor", "bd"), "team")
    assert _tile(module, "in_module") == 6
    assert team["scope"] == "team"
    # The stranger's own site drops out; the one assigned to the team stays in.
    assert _tile(team, "in_module") == 5
    assert _tile(team, "team") == 1
    assert {w["name"] for w in team["workload"]["items"]} <= {"bd_exec", "bd_sup"}


async def test_legal_supervisor_gets_no_bd_numbers(engine, maker):
    ids = await _world(engine)
    async with maker() as db:
        out = await svc.build_summary(db, _user(ids, "legal_sup", "supervisor", "legal"))
    assert _tile(out, "in_module") == 1       # only the site that reached legal
    assert out["funnel"]["module"] == "legal"
    assert "cycle_times" not in out
    assert [m["key"] for m in out["modules"]["items"]] == ["legal"]
    assert out["inbox"]["total"] == 1


async def test_legal_executive_sees_only_active_delegations(engine, maker):
    ids = await _world(engine)
    async with maker() as db:
        out = await svc.build_summary(db, _user(ids, "legal_exec", "executive", "legal"))
    assert _tile(out, "mine") == 1


async def test_admin_simulating_an_executive_gets_the_module_view(engine, maker):
    ids = await _world(engine)
    async with maker() as db:
        out = await svc.build_summary(db, _user(ids, "admin", "executive", "bd", real_role="business_admin"))
    assert out["simulated"] is True and out["role"] == "supervisor"
    assert _tile(out, "in_module") == 5


async def test_nso_summary_and_version(engine, maker):
    ids = await _world(engine)
    async with maker() as db:
        nso = await svc.build_nso_summary(db, _user(ids, "legal_exec", "supervisor", "nso", real_role="executive"))
        v1 = await svc.get_version(db, str(ids["tenant"]))
        v1_again = await svc.get_version(db, str(ids["tenant"]))
    assert nso["module"] == "nso" and nso["simulated"] is False
    assert _tile(nso, "in_module") == 1
    assert v1 == v1_again
    async with engine.begin() as c:
        await c.execute(_INSERT_AUDIT, {"t": ids["tenant"], "s": ids["s_draft"], "a": ids["bd_exec"]})
    async with maker() as db:
        v2 = await svc.get_version(db, str(ids["tenant"]))
    assert v2 != v1
    # A new access request writes no audit event but still moves the version.
    async with engine.begin() as c:
        await c.execute(text(
            "insert into supervisor_executive_requests (tenant_id, supervisor_id, module, status) "
            "values (:t, :u, 'bd', 'pending')"
        ), {"t": ids["tenant"], "u": ids["bd_sup"]})
    async with maker() as db:
        assert await svc.get_version(db, str(ids["tenant"])) != v2
