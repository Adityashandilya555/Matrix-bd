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

PG_URL = os.environ.get("MATRIX_TEST_PG_URL")
pytestmark = pytest.mark.skipif(not PG_URL, reason="MATRIX_TEST_PG_URL not set")


@pytest.fixture
async def engine():
    eng = create_async_engine(PG_URL, poolclass=NullPool)
    yield eng
    await eng.dispose()


@pytest.fixture
def maker(engine):
    return async_sessionmaker(engine, sync_session_class=MatrixSession, expire_on_commit=False, autoflush=False)


async def _world(engine, *, enabled=True, ca_code="EX-BLR-001", endpoint=True):
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
            "insert into sites (id, tenant_id, name, city, submitted_by, ca_code, google_maps_pin) "
            "values (:s, :t, 'Indiranagar', 'Bengaluru', :u, :c, '12.9716, 77.6412')"
        ), {"s": sid, "t": tid, "u": uid, "c": ca_code})
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
    seq, event_type, payload = rows[0]
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
        await db.delete(site)
        await db.commit()
    (_, event_type, payload), = await _outbox(engine, sid)
    assert event_type == "site.deleted"
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

