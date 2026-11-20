"""NSO sender + admin service against a real Postgres. Same setup as test_nso_capture_pg.py.

HTTP goes to an httpx.MockTransport; DNS is stubbed so nothing leaves the machine.
"""
from __future__ import annotations

import asyncio
import json
import uuid

import httpx
import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import text

from app.core.config import settings
from app.db import models
from app.integrations import secrets as secret_store
from app.integrations import sender, signing
from app.services import integration_service as svc
from tests.test_nso_capture_pg import PG_URL, _outbox, _world, engine, maker  # noqa: F401 (fixtures)

pytestmark = pytest.mark.skipif(not PG_URL, reason="MATRIX_TEST_PG_URL not set")

ADMIN = {"sub": None, "name": "Admin"}


@pytest.fixture(autouse=True)
def _wire(monkeypatch, maker):  # noqa: F811
    monkeypatch.setattr(settings, "integration_secret_key", f"key1:{Fernet.generate_key().decode()}")
    monkeypatch.setattr(sender, "SessionLocal", maker)

    async def _public(_url):
        return None
    monkeypatch.setattr(sender, "assert_public_host", _public)
    monkeypatch.setattr(svc, "assert_public_host", _public)


async def _setup(engine, maker, **kw):  # noqa: F811
    """World with a real encrypted secret, one queued snapshot. Returns (tid, sid, secret)."""
    tid, _, sid = await _world(engine, endpoint=False, **kw)
    async with maker() as db:
        out = await svc.save_config(db, str(tid), ADMIN, "https://nso.example.com/hook", True)
        await db.commit()
    async with maker() as db:
        site = await db.get(models.Site, sid)
        site.name = "Queued"
        await db.commit()
    return tid, sid, out["secret"]


async def _status(engine, sid):  # noqa: F811
    async with engine.connect() as conn:
        return (await conn.execute(text(
            "select status, attempts, last_http_status from integration_outbox where site_id = :s order by seq"
        ), {"s": sid})).all()


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def _drain(client):
    """Run passes until nothing more is due (other tests' rows may be queued too)."""
    while await sender.run_once(client):
        pass


async def test_delivers_signed_event(engine, maker):  # noqa: F811
    _, sid, secret = await _setup(engine, maker)
    seen = []

    def handler(request: httpx.Request):
        seen.append(request)
        return httpx.Response(200, text="ok")

    async with _client(handler) as client:
        await _drain(client)
    mine = [r for r in seen if json.loads(r.content)["site"]["id"] == str(sid)]
    assert len(mine) == 1
    req = mine[0]
    body = json.loads(req.content)
    assert body["event_type"] == "site.updated" and body["site"]["name"] == "Queued"
    assert req.headers["x-matrix-event-id"] == body["event_id"]
    assert signing.verify(header=req.headers["x-matrix-signature"], secret=secret,
                          timestamp=req.headers["x-matrix-timestamp"], body=req.content,
                          now=int(req.headers["x-matrix-timestamp"]))
    assert await _status(engine, sid) == [("sent", 1, 200)]
    async with engine.connect() as conn:
        n = (await conn.execute(text(
            "select count(*) from integration_deliveries d join integration_outbox o on o.id = d.outbox_id "
            "where o.site_id = :s and d.http_status = 200"), {"s": sid})).scalar()
    assert n == 1


async def test_server_error_retries_then_client_error_is_dead(engine, maker):  # noqa: F811
    _, sid, _ = await _setup(engine, maker)
    async with _client(lambda r: httpx.Response(503)) as client:
        await _drain(client)
    assert await _status(engine, sid) == [("failed", 1, 503)]

    async with engine.begin() as conn:  # make it due again
        await conn.execute(text("update integration_outbox set next_attempt_at = now() where site_id = :s"), {"s": sid})
    async with _client(lambda r: httpx.Response(400, text="bad schema")) as client:
        await _drain(client)
    assert await _status(engine, sid) == [("dead", 2, 400)]


async def test_network_error_is_retried(engine, maker):  # noqa: F811
    _, sid, _ = await _setup(engine, maker)

    def boom(_request):
        raise httpx.ConnectTimeout("timed out")

    async with _client(boom) as client:
        await _drain(client)
    status, attempts, http_status = (await _status(engine, sid))[0]
    assert (status, attempts, http_status) == ("failed", 1, None)


async def test_disabled_workspace_parks_without_counting(engine, maker):  # noqa: F811
    tid, sid, _ = await _setup(engine, maker)
    async with maker() as db:
        await svc.save_config(db, str(tid), ADMIN, "https://nso.example.com/hook", False)
        await db.commit()
    async with _client(lambda r: httpx.Response(200)) as client:
        await _drain(client)
    assert await _status(engine, sid) == [("pending", 0, None)]


async def test_two_workers_never_claim_the_same_row(engine, maker):  # noqa: F811
    _, sid, _ = await _setup(engine, maker)
    first, second = await asyncio.gather(sender.claim(500), sender.claim(500))
    ids_a, ids_b = {r.id for r in first}, {r.id for r in second}
    assert not ids_a & ids_b
    assert ids_a | ids_b  # something was claimed
    async with engine.begin() as conn:  # release everything for other tests
        await conn.execute(text("update integration_outbox set status = 'pending', locked_at = null where status = 'sending'"))


async def test_stale_claim_is_reclaimed(engine, maker):  # noqa: F811
    _, sid, _ = await _setup(engine, maker)
    async with engine.begin() as conn:
        await conn.execute(text(
            "update integration_outbox set status = 'sending', locked_at = now() - interval '10 minutes' where site_id = :s"
        ), {"s": sid})
    await sender.reclaim_stale()
    assert (await _status(engine, sid))[0][0] == "failed"


async def test_rotation_signs_with_both_secrets(engine, maker):  # noqa: F811
    tid, sid, old = await _setup(engine, maker)
    async with maker() as db:
        new = (await svc.rotate_secret(db, str(tid), ADMIN))["secret"]
        await db.commit()
    seen = []
    async with _client(lambda r: (seen.append(r), httpx.Response(200))[1]) as client:
        await _drain(client)
    req = next(r for r in seen if json.loads(r.content)["site"]["id"] == str(sid))
    for secret in (old, new):
        assert signing.verify(header=req.headers["x-matrix-signature"], secret=secret,
                              timestamp=req.headers["x-matrix-timestamp"], body=req.content,
                              now=int(req.headers["x-matrix-timestamp"]))


async def test_secret_only_stored_encrypted_and_shown_once(engine, maker):  # noqa: F811
    tid, _, secret = await _setup(engine, maker)
    async with maker() as db:
        again = await svc.save_config(db, str(tid), ADMIN, "https://nso.example.com/other", True)
        cfg = await svc.get_config(db, str(tid))
        await db.commit()
    assert again["secret"] is None
    assert secret not in json.dumps(cfg, default=str)
    async with engine.connect() as conn:
        stored = (await conn.execute(text(
            "select secret_ciphertext, secret_key_version from integration_endpoints where tenant_id = :t"), {"t": tid})).one()
    assert secret not in stored[0]
    assert secret_store.decrypt(stored[0], stored[1]) == secret


async def test_backfill_queues_eligible_sites_once(engine, maker):  # noqa: F811
    tid, sid, _ = await _setup(engine, maker)
    async with maker() as db:
        first = await svc.backfill(db, str(tid), ADMIN)
        await db.commit()
    assert first == {"eligible": 1, "queued": 0}  # already up to date from _setup
    async with engine.begin() as conn:
        await conn.execute(text("delete from integration_outbox where site_id = :s"), {"s": sid})
    async with maker() as db:
        second = await svc.backfill(db, str(tid), ADMIN)
        await db.commit()
    assert second == {"eligible": 1, "queued": 1}


async def test_test_event_and_replay(engine, maker):  # noqa: F811
    tid, _, _ = await _setup(engine, maker)
    async with maker() as db:
        await svc.send_test(db, str(tid), ADMIN)
        await db.commit()
    async with _client(lambda r: httpx.Response(404)) as client:
        await _drain(client)
    async with maker() as db:
        dead = await svc.list_dead(db, str(tid))
        assert {d["event_type"] for d in dead} >= {"site.test"}
        test_row = next(d for d in dead if d["event_type"] == "site.test")
        await svc.replay(db, str(tid), ADMIN, uuid.UUID(test_row["id"]))
        await db.commit()
    async with _client(lambda r: httpx.Response(200)) as client:
        await _drain(client)
    async with maker() as db:
        cfg = await svc.get_config(db, str(tid))
    assert cfg["counts"]["dead"] == 1  # the site.updated row is still dead; the test event was replayed and sent
    assert cfg["counts"]["sent"] == 1


async def test_actions_need_an_enabled_endpoint(engine, maker):  # noqa: F811
    tid, _, _ = await _world(engine, endpoint=False)
    async with maker() as db:
        with pytest.raises(HTTPException) as exc:
            await svc.send_test(db, str(tid), ADMIN)
    assert exc.value.status_code == 409


async def test_rejects_http_and_hostless_urls(engine, maker):  # noqa: F811
    tid, _, _ = await _world(engine, endpoint=False)
    for bad in ("http://nso.example.com", "https://", "https:///x"):
        async with maker() as db:
            with pytest.raises(HTTPException) as exc:
                await svc.save_config(db, str(tid), ADMIN, bad, True)
        assert exc.value.status_code == 422
