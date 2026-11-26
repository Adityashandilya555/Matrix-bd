"""NSO capture hooks against a real Postgres (schema.sql loaded).

Skipped unless MATRIX_TEST_PG_URL points at a throwaway database built from
backend/database/schema.sql, e.g.:

    docker run -d --rm --name nso-pg -e POSTGRES_PASSWORD=localtest -p 127.0.0.1:54331:5432 postgres:17
    docker exec -i nso-pg psql -U postgres -c 'create database matrix_test'
    docker exec -i nso-pg psql -U postgres -d matrix_test < database/schema.sql
    MATRIX_TEST_PG_URL=postgresql+asyncpg://postgres:localtest@127.0.0.1:54331/matrix_test pytest tests/test_nso_capture_pg.py

Never point it at a shared or production database: every test writes rows.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from datetime import date, datetime, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.db import models
from app.db.session import MatrixSession
from app.integrations import capture
from app.integrations import nso_payload as nso

PG_URL = os.environ.get("MATRIX_TEST_PG_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="MATRIX_TEST_PG_URL not set")


@pytest.fixture(autouse=True)
def _strict_capture():
    """Surface capture errors in tests (production logs them and lets the save go on)."""
    capture.set_strict(True)
    capture.set_active(True)
    yield
    capture.set_strict(False)
    capture.set_active(True)


@pytest.fixture
async def engine():
    eng = create_async_engine(PG_URL, poolclass=NullPool)
    yield eng
    await eng.dispose()


@pytest.fixture
def maker(engine):
    return async_sessionmaker(engine, sync_session_class=MatrixSession, expire_on_commit=False, autoflush=False)


async def _world(engine, *, enabled=True, ca_code="EX-BLR-001", endpoint=True, finance="approved",
                 status="draft_submitted"):
    """Tenant + user + site (+ endpoint) written with Core, so no hook fires."""
    tid, uid, sid = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    tag = tid.hex[:10]
    async with engine.begin() as conn:
        await conn.execute(text(
            "insert into tenants (id, name, slug, workspace_code) values (:t, 'Example Coffee Co', :s, :w)"
        ), {"t": tid, "s": f"ex-{tag}", "w": f"WS{tag}".upper()})
        await conn.execute(text(
            "insert into users (id, tenant_id, email, name, role) values (:u, :t, :e, 'Exec', 'executive')"
        ), {"u": uid, "t": tid, "e": f"{tag}@example.com"})
        await conn.execute(text(
            "insert into sites (id, tenant_id, name, city, submitted_by, ca_code, finance_status, google_maps_pin, status) "
            "values (:s, :t, 'Indiranagar', 'Bengaluru', :u, :c, :f, '12.9716, 77.6412', :st)"
        ), {"s": sid, "t": tid, "u": uid, "c": ca_code, "f": finance, "st": status})
        if endpoint:
            await conn.execute(text(
                "insert into integration_endpoints (tenant_id, integration, enabled, endpoint_url, secret_ciphertext) "
                "values (:t, 'nso_platform', :e, 'https://nso.example.com/hook', 'x')"
            ), {"t": tid, "e": enabled})
    return tid, uid, sid


async def _outbox(engine, sid):
    async with engine.connect() as conn:
        rows = await conn.execute(text(
            "select seq, event_type, payload from integration_outbox where site_id = :s order by seq"
        ), {"s": sid})
        return rows.all()


async def test_watched_change_queues_one_snapshot(engine, maker):
    _, _, sid = await _world(engine)
    async with maker() as db:
        site = await db.get(models.Site, sid)
        site.name = "Indiranagar 100ft"
        site.model = "Cafe"  # two watched changes, one event
        await db.commit()
    rows = await _outbox(engine, sid)
    assert len(rows) == 1
    _, event_type, payload = rows[0]
    assert event_type == "site.updated"
    assert payload["site"]["name"] == "Indiranagar 100ft"
    assert payload["site"]["cafe_code"] == "EX-BLR-001"
    assert payload["site"]["lat"] == 12.9716
    assert payload["company"]["name"] == "Example Coffee Co"
    assert "workspace_code" not in str(payload)


async def test_rollback_queues_nothing(engine, maker):
    _, _, sid = await _world(engine)
    async with maker() as db:
        site = await db.get(models.Site, sid)
        site.name = "Changed"
        await db.flush()
        await db.rollback()
    assert await _outbox(engine, sid) == []


async def test_unwatched_change_queues_nothing(engine, maker):
    _, _, sid = await _world(engine)
    async with maker() as db:
        site = await db.get(models.Site, sid)
        site.expected_rent = 123456
        await db.commit()
    assert await _outbox(engine, sid) == []


@pytest.mark.parametrize("kwargs", [{"enabled": False}, {"endpoint": False}, {"ca_code": None}])
async def test_disabled_missing_or_ineligible_queues_nothing(engine, maker, kwargs):
    _, _, sid = await _world(engine, **kwargs)
    async with maker() as db:
        site = await db.get(models.Site, sid)
        site.name = "Changed"
        await db.commit()
    assert await _outbox(engine, sid) == []


async def test_identical_snapshot_is_skipped(engine, maker):
    _, _, sid = await _world(engine)
    async with maker() as db:
        site = await db.get(models.Site, sid)
        site.name = "Once"
        await db.commit()
    async with maker() as db:
        queued = await db.run_sync(lambda s: capture.queue_site_snapshot(s, sid))
        await db.commit()
    assert queued is False
    assert len(await _outbox(engine, sid)) == 1


async def test_related_tables_are_watched(engine, maker):
    tid, _, sid = await _world(engine)
    async with maker() as db:
        db.add(models.SiteLicensing(site_id=sid, fssai="yes"))
        db.add(models.ProjectReview(
            site_id=sid, tenant_id=tid, initialization_date=date(2026, 10, 1), initialization_status="approved",
            pushed_to_nso_at=datetime(2026, 11, 15, 9, 0, tzinfo=timezone.utc),
        ))
        db.add(models.NsoReview(site_id=sid, tenant_id=tid, launch_date=date(2026, 12, 1)))
        await db.commit()
    (_, _, payload), = await _outbox(engine, sid)
    assert payload["licences"] == {"fssai_status": "yes"}
    assert payload["dates"] == {
        "project_start": "2026-10-01", "handover": "2026-11-15", "live_planned": "2026-12-01", "live_actual": None,
    }


async def test_project_start_hidden_until_approved(engine, maker):
    tid, _, sid = await _world(engine)
    async with maker() as db:
        db.add(models.ProjectReview(site_id=sid, tenant_id=tid, initialization_date=date(2026, 10, 1),
                                    initialization_status="proposed"))
        await db.commit()
    (_, _, payload), = await _outbox(engine, sid)
    assert payload["dates"]["project_start"] is None


async def test_delete_queues_tombstone_that_outlives_the_site(engine, maker):
    _, _, sid = await _world(engine)
    async with maker() as db:
        site = await db.get(models.Site, sid)
        await db.run_sync(lambda s: capture.queue_site_snapshot(s, sid, force=True))
        await db.commit()
        await db.delete(site)
        await db.commit()
    rows = await _outbox(engine, sid)
    assert [r.event_type for r in rows] == ["site.updated", "site.deleted"]
    payload = rows[1].payload
    assert payload["site"] == {"id": str(sid), "cafe_code": "EX-BLR-001", "name": "Indiranagar"}


async def test_losing_eligibility_sends_one_last_update(engine, maker):
    _, _, sid = await _world(engine)
    async with maker() as db:
        site = await db.get(models.Site, sid)
        site.name = "Shared"
        await db.commit()
        site.ca_code = None
        await db.commit()
        site.name = "No longer shared"
        await db.commit()
    rows = await _outbox(engine, sid)
    assert [r.payload["site"]["cafe_code"] for r in rows] == ["EX-BLR-001", None]


async def test_rolled_back_savepoint_keeps_outer_changes(engine, maker):
    _, _, sid = await _world(engine)
    async with maker() as db:
        site = await db.get(models.Site, sid)
        site.name = "Outer change"
        await db.flush()
        nested = await db.begin_nested()
        await nested.rollback()
        await db.commit()
    (_, _, payload), = await _outbox(engine, sid)
    assert payload["site"]["name"] == "Outer change"


async def test_seq_follows_commit_order_per_site(engine, maker):
    """Codex finding on PR 514: the higher seq must carry the newer data."""
    tid, _, sid = await _world(engine)
    async with maker() as a, maker() as b:
        site_a = await a.get(models.Site, sid)
        site_a.name = "From A"
        await a.flush()  # A now holds the site row lock

        b.add(models.NsoReview(site_id=sid, tenant_id=tid, launch_date=date(2027, 1, 1)))
        b_commit = asyncio.create_task(b.commit())  # must wait for A's lock
        await asyncio.sleep(0.5)
        assert not b_commit.done()

        await a.commit()
        await b_commit
    rows = await _outbox(engine, sid)
    assert len(rows) == 2
    assert rows[0].payload["site"]["name"] == "From A"
    assert rows[1].payload["site"]["name"] == "From A"  # B saw A's committed change
    assert rows[1].payload["dates"]["live_planned"] == "2027-01-01"
    assert rows[1].seq > rows[0].seq


async def test_outbox_rows_have_no_site_fk(engine):
    async with engine.connect() as conn:
        fks = (await conn.execute(text(
            "select count(*) from pg_constraint where conrelid = 'public.integration_outbox'::regclass "
            "and contype = 'f' and confrelid = 'public.sites'::regclass"
        ))).scalar()
    assert fks == 0



async def test_rolled_back_savepoint_delete_is_an_update_not_a_tombstone(engine, maker):
    _, _, sid = await _world(engine)
    async with maker() as db:
        site = await db.get(models.Site, sid)
        site.name = "Renamed"
        await db.flush()
        nested = await db.begin_nested()
        await db.delete(site)
        await db.flush()
        await nested.rollback()
        await db.commit()
    rows = await _outbox(engine, sid)
    assert [r.event_type for r in rows] == ["site.updated"]
    assert rows[0].payload["site"]["name"] == "Renamed"


# ── Second review (PR 515) ───────────────────────────────────────────────


async def test_draft_cafe_code_is_not_shared_until_finance_approves(engine, maker):
    _, _, sid = await _world(engine, ca_code=None, finance="pending")
    async with maker() as db:
        site = await db.get(models.Site, sid)
        site.ca_code = "EX-BLR-9"  # executive's finance draft
        await db.commit()
        assert await _outbox(engine, sid) == []
        site.finance_status = "approved"  # business admin approves
        await db.commit()
    (_, _, payload), = await _outbox(engine, sid)
    assert payload["site"]["cafe_code"] == "EX-BLR-9"


async def test_never_sent_site_gets_no_tombstone(engine, maker):
    _, _, sid = await _world(engine)
    async with maker() as db:
        await db.delete(await db.get(models.Site, sid))
        await db.commit()
    assert await _outbox(engine, sid) == []


async def test_site_that_lost_its_code_still_gets_a_tombstone(engine, maker):
    _, _, sid = await _world(engine)
    async with maker() as db:
        site = await db.get(models.Site, sid)
        site.name = "Shared"
        await db.commit()
        site.ca_code = None
        await db.commit()
        await db.delete(site)
        await db.commit()
    assert [r.event_type for r in await _outbox(engine, sid)] == ["site.updated", "site.updated", "site.deleted"]


async def test_savepoint_release_does_not_queue_early(engine, maker):
    _, _, sid = await _world(engine)
    async with maker() as db:
        site = await db.get(models.Site, sid)
        async with db.begin_nested():
            site.name = "In savepoint"
        site.model = "Kiosk"
        await db.commit()
    (_, _, payload), = await _outbox(engine, sid)
    assert (payload["site"]["name"], payload["site"]["model"]) == ("In savepoint", "Kiosk")


async def test_capture_failure_never_breaks_the_save(engine, maker, monkeypatch, caplog):
    capture.set_strict(False)
    _, _, sid = await _world(engine)

    def boom(*_a, **_k):
        raise RuntimeError("integration bug")
    monkeypatch.setattr(nso, "build_snapshot", boom)
    async with maker() as db:
        site = await db.get(models.Site, sid)
        site.name = "Saved anyway"
        await db.commit()
    async with engine.connect() as conn:
        name = (await conn.execute(text("select name from sites where id = :s"), {"s": sid})).scalar()
    assert name == "Saved anyway"
    assert await _outbox(engine, sid) == []
    assert "nso capture failed" in caplog.text


async def test_missing_integration_tables_do_not_break_saves(engine, maker):
    """Simulated inside a transaction: the tables are dropped, the save still commits."""
    capture.set_strict(False)
    _, _, sid = await _world(engine)
    async with maker() as db:
        await db.execute(text("ALTER TABLE integration_endpoints RENAME TO integration_endpoints_gone"))
        site = await db.get(models.Site, sid)
        site.name = "Still saves"
        await db.commit()  # rename is committed too; undo it below
    async with engine.begin() as conn:
        await conn.execute(text("ALTER TABLE integration_endpoints_gone RENAME TO integration_endpoints"))
    async with engine.connect() as conn:
        assert (await conn.execute(text("select name from sites where id = :s"), {"s": sid})).scalar() == "Still saves"


async def test_inactive_capture_runs_no_queries(engine, maker):
    capture.set_active(False)
    _, _, sid = await _world(engine)
    async with maker() as db:
        site = await db.get(models.Site, sid)
        site.name = "Off"
        await db.commit()
    assert await _outbox(engine, sid) == []


async def test_fssai_is_sent_only_once_legal_publishes(engine, maker):
    _, _, sid = await _world(engine)
    async with maker() as db:
        lic = models.SiteLicensing(site_id=sid, fssai="yes", stage="draft")  # executive draft
        db.add(lic)
        await db.commit()
        lic.stage = "pending_review"
        await db.commit()
        lic.stage = "published"  # supervisor publishes
        await db.commit()
    rows = await _outbox(engine, sid)
    assert [r.payload["licences"]["fssai_status"] for r in rows] == [None, "yes"]


# ── Shared from the Legal push, before Finance approves a CA code ─────────


async def test_legal_push_shares_a_site_without_a_ca_code(engine, maker):
    _, _, sid = await _world(engine, ca_code=None, status="loi_uploaded")
    async with maker() as db:
        site = await db.get(models.Site, sid)
        site.name = "Before the push"  # not shared yet
        await db.commit()
        assert await _outbox(engine, sid) == []
        site.status = "legal_review"  # what the staging push writes
        site.legal_review_at = datetime.now(timezone.utc)
        await db.commit()
    rows = await _outbox(engine, sid)
    assert len(rows) == 1
    assert rows[0].payload["site"]["cafe_code"] is None
    assert rows[0].payload["site"]["status"] == "legal_review"
    assert rows[0].payload["site"]["name"] == "Before the push"


async def test_fssai_positive_is_sent_for_a_pushed_site(engine, maker):
    _, _, sid = await _world(engine, ca_code=None, status="legal_review")
    async with maker() as db:
        site = await db.get(models.Site, sid)
        site.name = "Pushed"
        await db.commit()
        lic = models.SiteLicensing(site_id=sid, fssai="yes", stage="draft")  # executive draft: not sent
        db.add(lic)
        await db.commit()
        lic.stage = "published"  # Legal publishes
        await db.commit()
    rows = await _outbox(engine, sid)
    assert [r.payload["licences"]["fssai_status"] for r in rows] == [None, "yes"]


async def test_leaving_the_pipeline_sends_one_last_update_and_revival_shares_again(engine, maker):
    _, _, sid = await _world(engine, ca_code=None, status="legal_review")
    async with maker() as db:
        site = await db.get(models.Site, sid)
        site.name = "Shared"
        await db.commit()
        site.status = "archived"
        await db.commit()
        site.name = "Archived edit"  # no longer shared: nothing
        await db.commit()
        site.status = "legal_review"  # revived
        await db.commit()
    rows = await _outbox(engine, sid)
    assert [(r.payload["site"]["status"], r.payload["site"]["name"]) for r in rows] == [
        ("legal_review", "Shared"), ("archived", "Shared"), ("legal_review", "Archived edit"),
    ]
