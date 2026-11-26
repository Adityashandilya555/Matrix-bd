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
from app.integrations import capture
from app.services import integration_service as svc
from tests.test_nso_capture_pg import PG_URL, _outbox, _world, engine, maker  # noqa: F401 (fixtures)

pytestmark = pytest.mark.skipif(not PG_URL, reason="MATRIX_TEST_PG_URL not set")

ADMIN = {"sub": None, "name": "Admin"}


@pytest.fixture(autouse=True)
def _wire(monkeypatch, maker):  # noqa: F811
    capture.set_strict(True)
    capture.set_active(True)
    monkeypatch.setattr(settings, "integration_secret_key", f"key1:{Fernet.generate_key().decode()}")
    monkeypatch.setattr(sender, "SessionLocal", maker)

    async def _public(_url):
        return None

    async def _addr(_url):
        return "93.184.216.34"  # never contacted: requests go to MockTransport
    monkeypatch.setattr(sender, "resolve_public_address", _addr)
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
    claimed = await sender.run_once(client)
    while claimed:
        claimed = await sender.run_once(client)


def _only(items):
    """The single matching item; fails the test clearly otherwise."""
    items = list(items)
    assert len(items) == 1, items
    return items[0]


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
    await _setup(engine, maker)
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
    req = _only(r for r in seen if json.loads(r.content)["site"]["id"] == str(sid))
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
        test_row = _only(d for d in dead if d["event_type"] == "site.test")
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


# ── Review fixes (PR 515) ────────────────────────────────────────────────


async def test_dead_event_does_not_block_backfill(engine, maker):  # noqa: F811
    tid, sid, _ = await _setup(engine, maker)
    async with _client(lambda r: httpx.Response(401)) as client:
        await _drain(client)
    assert (await _status(engine, sid))[0][0] == "dead"
    async with maker() as db:
        out = await svc.backfill(db, str(tid), ADMIN)
        await db.commit()
    assert out == {"eligible": 1, "queued": 1}


async def test_can_switch_off_when_dns_fails_or_key_missing(engine, maker, monkeypatch):  # noqa: F811
    tid, _, _ = await _setup(engine, maker)

    async def _broken(_url):
        raise sender.BlockedAddressError("cannot resolve nso.example.com")
    monkeypatch.setattr(svc, "assert_public_host", _broken)
    monkeypatch.setattr(settings, "integration_secret_key", "")
    async with maker() as db:
        out = await svc.save_config(db, str(tid), ADMIN, "https://nso.example.com/hook", False)
        await db.commit()
    assert out["enabled"] is False


async def test_enabling_reports_just_enabled(engine, maker):  # noqa: F811
    tid, _, _ = await _world(engine, endpoint=False)
    async with maker() as db:
        off = await svc.save_config(db, str(tid), ADMIN, "https://nso.example.com/hook", False)
        on = await svc.save_config(db, str(tid), ADMIN, "https://nso.example.com/hook", True)
        again = await svc.save_config(db, str(tid), ADMIN, "https://nso.example.com/hook", True)
        await db.commit()
    assert (off["just_enabled"], on["just_enabled"], again["just_enabled"]) == (False, True, False)


async def test_result_after_losing_the_claim_does_not_overwrite(engine, maker, monkeypatch):  # noqa: F811
    _, sid, _ = await _setup(engine, maker)
    async with engine.begin() as conn:
        await conn.execute(text("update integration_outbox set next_attempt_at = now() + interval '1 day' where site_id <> :s"), {"s": sid})
    (row,) = [r for r in await sender.claim(500) if r.payload["site"]["id"] == str(sid)]
    # Another worker reclaims and re-claims the row while ours is "in flight".
    async with engine.begin() as conn:
        await conn.execute(text(
            "update integration_outbox set status = 'sending', locked_by = 'other-worker', attempts = attempts + 1 "
            "where id = :i"), {"i": row.id})
    await sender._record(row, sender.Outcome(status="failed", http_status=500))
    async with engine.connect() as conn:
        status, locked_by = (await conn.execute(text(
            "select status, locked_by from integration_outbox where id = :i"), {"i": row.id})).one()
        logged = (await conn.execute(text(
            "select count(*) from integration_deliveries where outbox_id = :i"), {"i": row.id})).scalar()
    assert (status, locked_by) == ("sending", "other-worker")
    assert logged == 1
    assert not await sender._refresh_claim(row.id)


async def test_dns_failure_is_retried_not_dead(engine, maker, monkeypatch):  # noqa: F811
    _, sid, _ = await _setup(engine, maker)

    async def _nxdomain(_url):
        raise sender.ResolveError("cannot resolve nso.example.com")
    monkeypatch.setattr(sender, "resolve_public_address", _nxdomain)
    async with _client(lambda r: httpx.Response(200)) as client:
        await _drain(client)
    assert (await _status(engine, sid))[0][:2] == ("failed", 1)


async def test_purge_keeps_the_first_and_newest_row_per_site(engine, maker):  # noqa: F811
    _, sid, _ = await _setup(engine, maker)
    async with maker() as db:
        site = await db.get(models.Site, sid)
        site.name = "Second"
        await db.commit()
        site.name = "Third"
        await db.commit()
    async with engine.begin() as conn:
        await conn.execute(text(
            "update integration_outbox set status = 'sent', sent_at = now() - interval '40 days' where site_id = :s"
        ), {"s": sid})
    await sender.purge_all_sent()
    rows = await _outbox(engine, sid)
    # The first row stays so the per-site history can say when it was first sent.
    assert [r.payload["site"]["name"] for r in rows] == ["Queued", "Third"]


async def test_second_rotation_is_refused_while_one_is_open(engine, maker):  # noqa: F811
    tid, _, _ = await _setup(engine, maker)
    async with maker() as db:
        await svc.rotate_secret(db, str(tid), ADMIN)
        await db.commit()
    async with maker() as db:
        with pytest.raises(HTTPException) as exc:
            await svc.rotate_secret(db, str(tid), ADMIN)
    assert exc.value.status_code == 409


async def test_url_credentials_rejected_and_audit_omits_query(engine, maker):  # noqa: F811
    tid, _, _ = await _world(engine, endpoint=False)
    async with maker() as db:
        with pytest.raises(HTTPException) as exc:
            await svc.save_config(db, str(tid), ADMIN, "https://user:pw@nso.example.com/hook", True)
        assert exc.value.status_code == 422
    async with maker() as db:
        await svc.save_config(db, str(tid), ADMIN, "https://nso.example.com/hook?token=abc123", True)
        await db.commit()
    async with engine.connect() as conn:
        details = (await conn.execute(text(
            "select detail from audit_logs where tenant_id = :t"), {"t": tid})).scalars().all()
    assert details and all("abc123" not in d for d in details)


async def test_enabling_wakes_parked_rows(engine, maker):  # noqa: F811
    tid, sid, _ = await _setup(engine, maker)
    async with engine.begin() as conn:
        await conn.execute(text(
            "update integration_outbox set next_attempt_at = now() + interval '1 hour' where site_id = :s"), {"s": sid})
    async with maker() as db:
        await svc.save_config(db, str(tid), ADMIN, "https://nso.example.com/hook", False)
        await svc.save_config(db, str(tid), ADMIN, "https://nso.example.com/hook", True)
        await db.commit()
    async with engine.connect() as conn:
        due = (await conn.execute(text(
            "select next_attempt_at <= now() from integration_outbox where site_id = :s"), {"s": sid})).scalar()
    assert due is True


async def test_backfill_skips_unapproved_cafe_codes(engine, maker):  # noqa: F811
    tid, _, _ = await _world(engine, endpoint=False, finance="pending")
    async with maker() as db:
        await svc.save_config(db, str(tid), ADMIN, "https://nso.example.com/hook", True)
        await db.commit()
    async with maker() as db:
        out = await svc.backfill(db, str(tid), ADMIN)
        await db.commit()
    assert out == {"eligible": 0, "queued": 0}


# ── Owner review + CodeAnt nitpicks ──────────────────────────────────────


async def test_bad_port_is_rejected_on_save(engine, maker):  # noqa: F811
    tid, _, _ = await _world(engine, endpoint=False)
    for bad in ("https://nso.example.com:99999/hook", "https://nso.example.com:abc/hook"):
        async with maker() as db:
            with pytest.raises(HTTPException) as exc:
                await svc.save_config(db, str(tid), ADMIN, bad, True)
        assert exc.value.status_code == 422


async def test_stored_bad_url_is_dead_and_does_not_stall_others(engine, maker):  # noqa: F811
    tid, sid, _ = await _setup(engine, maker)
    async with engine.begin() as conn:
        await conn.execute(text(
            "update integration_endpoints set endpoint_url = 'https://nso.example.com:99999/hook' where tenant_id = :t"
        ), {"t": tid})
    async with _client(lambda r: httpx.Response(200)) as client:
        await _drain(client)
    status, attempts, _ = (await _status(engine, sid))[0]
    assert (status, attempts) == ("dead", 1)


async def test_reclaim_at_max_attempts_goes_dead(engine, maker):  # noqa: F811
    _, sid, _ = await _setup(engine, maker)
    async with engine.begin() as conn:
        await conn.execute(text(
            "update integration_outbox set status = 'sending', attempts = :m, "
            "locked_at = now() - interval '10 minutes' where site_id = :s"), {"s": sid, "m": sender.MAX_ATTEMPTS})
    await sender.reclaim_stale()
    assert (await _status(engine, sid))[0][0] == "dead"


async def test_key_error_parks_without_counting(engine, maker, monkeypatch):  # noqa: F811
    _, sid, _ = await _setup(engine, maker)
    monkeypatch.setattr(settings, "integration_secret_key", f"key1:{Fernet.generate_key().decode()}")  # wrong key
    async with _client(lambda r: httpx.Response(200)) as client:
        await _drain(client)
    assert await _status(engine, sid) == [("pending", 0, None)]


async def test_lost_claim_is_not_charged_an_attempt(engine, maker):  # noqa: F811
    _, sid, _ = await _setup(engine, maker)
    rows = [r for r in await sender.claim(500) if r.payload["site"]["id"] == str(sid)]
    async with engine.begin() as conn:
        await conn.execute(text("update integration_outbox set locked_by = 'other' where site_id = :s"), {"s": sid})
    async with _client(lambda r: httpx.Response(200)) as client:
        assert await sender.deliver(client, rows[0]) == "skipped"
    assert (await _status(engine, sid))[0][1] == 0
    async with engine.begin() as conn:
        await conn.execute(text("update integration_outbox set status = 'pending', locked_by = null where status = 'sending'"))


async def test_rotation_survives_a_dropped_encryption_key(engine, maker, monkeypatch):  # noqa: F811
    tid, _, _ = await _setup(engine, maker)
    monkeypatch.setattr(settings, "integration_secret_key", f"key2:{Fernet.generate_key().decode()}")
    async with maker() as db:
        out = await svc.rotate_secret(db, str(tid), ADMIN)
        await db.commit()
    assert out["secret"].startswith("whsec_") and out["previous_valid_until"] is None


async def test_concurrent_first_save_is_a_409(engine, maker, monkeypatch):  # noqa: F811
    tid, _, _ = await _world(engine)  # endpoint row already exists

    async def _not_found(*_a, **_k):
        return None  # as if the other request's row wasn't visible yet
    monkeypatch.setattr(svc, "_endpoint", _not_found)
    async with maker() as db:
        with pytest.raises(HTTPException) as exc:
            await svc.save_config(db, str(tid), ADMIN, "https://nso.example.com/hook", True)
    assert exc.value.status_code == 409


async def test_tombstone_is_queued_while_switched_off(engine, maker):  # noqa: F811
    tid, sid, _ = await _setup(engine, maker)
    async with _client(lambda r: httpx.Response(200)) as client:
        await _drain(client)
    async with maker() as db:
        await svc.save_config(db, str(tid), ADMIN, "https://nso.example.com/hook", False)
        await db.commit()
    async with maker() as db:
        await db.delete(await db.get(models.Site, sid))
        await db.commit()
    rows = await _outbox(engine, sid)
    assert [r.event_type for r in rows] == ["site.updated", "site.deleted"]


async def test_workspace_rename_requeues_shared_sites(engine, maker):  # noqa: F811
    from app.services import tenancy_service
    tid, sid, _ = await _setup(engine, maker)
    async with maker() as db:
        await tenancy_service.update_tenant_branding(db, tenant_id=str(tid), name="Renamed Coffee Co", logo=None)
    rows = await _outbox(engine, sid)
    assert rows[-1].payload["company"]["name"] == "Renamed Coffee Co"


REJECTION = '{"error":"missing field city"}'


async def _rejected(engine, maker):  # noqa: F811
    """A site event and a test event, both rejected by NSO with a 400. Returns (tid, sid)."""
    tid, sid, _ = await _setup(engine, maker)
    async with maker() as db:
        await svc.send_test(db, str(tid), ADMIN)
        await db.commit()
    async with _client(lambda r: httpx.Response(400, text=REJECTION)) as client:
        await _drain(client)
    return tid, sid


def _for_site(rows, sid):
    return _only(d for d in rows if d["site"] and d["site"]["id"] == str(sid))


async def test_dead_rows_name_the_site_and_nso_reply(engine, maker):  # noqa: F811
    tid, sid = await _rejected(engine, maker)
    async with maker() as db:
        dead = await svc.list_dead(db, str(tid))
        listed = (await svc.list_sites(db, str(tid)))["sites"]
    row = _for_site(dead, sid)
    assert row["site"]["name"] == "Queued" and row["site"]["deleted"] is False
    assert row["response_snippet"] == REJECTION
    assert _only(r for r in listed if r["site"] is None)["state"] == "gave_up"  # the test event


async def test_event_detail_is_the_exact_body_and_tenant_scoped(engine, maker):  # noqa: F811
    tid, sid = await _rejected(engine, maker)
    async with maker() as db:
        row = _for_site(await svc.list_dead(db, str(tid)), sid)
        outbox_id = uuid.UUID(row["id"])
        detail = await svc.get_event(db, str(tid), outbox_id)
        with pytest.raises(HTTPException) as other_tenant:
            await svc.get_event(db, str(uuid.uuid4()), outbox_id)
    body = detail["body"]  # the envelope the sender posts
    assert (body["event_id"], body["event_type"], body["seq"]) == (row["id"], "site.updated", row["seq"])
    assert body["site"]["name"] == "Queued"
    assert [(a["attempt_no"], a["http_status"]) for a in detail["attempts"]] == [(1, 400)]
    assert other_tenant.value.status_code == 404


async def test_deleted_site_keeps_the_name_it_was_sent_with(engine, maker):  # noqa: F811
    tid, sid, _ = await _setup(engine, maker)
    async with _client(lambda r: httpx.Response(200)) as client:
        await _drain(client)
    async with engine.begin() as conn:
        await conn.execute(text("update integration_outbox set site_id = :n where site_id = :s"),
                           {"n": uuid.uuid4(), "s": sid})
    async with maker() as db:
        listed = (await svc.list_sites(db, str(tid)))["sites"]
    row = _only(r for r in listed if r["site"] and r["site"]["deleted"])
    assert row["site"]["name"] == "Queued"


async def _outbox_count(engine, sid):  # noqa: F811
    async with engine.connect() as conn:
        return (await conn.execute(text("select count(*) from integration_outbox where site_id = :s"), {"s": sid})).scalar()


async def test_lookup_by_ca_code_ignores_case_and_other_workspaces(engine, maker):  # noqa: F811
    tid, sid, _ = await _setup(engine, maker)
    other_tid, _, _ = await _setup(engine, maker)  # same CA code in another workspace
    async with maker() as db:
        found = await svc.lookup_site(db, str(tid), "  ex-blr-001 ")
        with pytest.raises(HTTPException) as missing:
            await svc.lookup_site(db, str(tid), "NOPE-1")
        with pytest.raises(HTTPException) as blank:
            await svc.lookup_site(db, str(tid), " ")
    assert other_tid != tid
    assert found["site"]["id"] == str(sid)
    assert found["site"]["code"] == "EX-BLR-001"
    assert found["shareable"] is True and found["reason"] is None
    assert found["last_event"]["status"] == "pending"
    assert (missing.value.status_code, blank.value.status_code) == (404, 422)


async def test_lookup_explains_an_unapproved_ca_code(engine, maker):  # noqa: F811
    tid, _, _ = await _setup(engine, maker, finance="pending")
    async with maker() as db:
        found = await svc.lookup_site(db, str(tid), "EX-BLR-001")
    assert found["shareable"] is False
    assert "sent to Legal" in found["reason"]


async def test_resend_queues_a_fresh_event_even_when_already_sent(engine, maker):  # noqa: F811
    tid, sid, _ = await _setup(engine, maker)
    async with _client(lambda r: httpx.Response(200)) as client:
        await _drain(client)
    async with maker() as db:
        backfill = await svc.backfill(db, str(tid), ADMIN)
        await db.commit()
    assert backfill["queued"] == 0  # already up to date: "Send all" skips it
    async with maker() as db:
        out = await svc.resend_site(db, str(tid), ADMIN, sid)
        await db.commit()
    assert out["queued"] is True and out["site"]["code"] == "EX-BLR-001"
    seen = []
    async with _client(lambda r: seen.append(json.loads(r.content)) or httpx.Response(200)) as client:
        await _drain(client)
    mine = [b for b in seen if b["site"]["id"] == str(sid)]
    assert len(mine) == 1 and mine[0]["site"]["name"] == "Queued"
    assert [row[0] for row in await _status(engine, sid)] == ["sent", "sent"]
    async with engine.connect() as conn:
        n = (await conn.execute(text(
            "select count(*) from audit_logs where tenant_id = :t and action = 'nso_integration_resend'"), {"t": tid})).scalar()
    assert n == 1


async def test_resend_refuses_unshareable_foreign_or_switched_off(engine, maker):  # noqa: F811
    tid, sid, _ = await _setup(engine, maker, finance="pending")
    other_tid, other_sid, _ = await _setup(engine, maker)
    async with maker() as db:
        with pytest.raises(HTTPException) as unapproved:
            await svc.resend_site(db, str(tid), ADMIN, sid)
        with pytest.raises(HTTPException) as foreign:
            await svc.resend_site(db, str(tid), ADMIN, other_sid)
        await svc.save_config(db, str(other_tid), ADMIN, "https://nso.example.com/hook", False)
        await db.commit()
    async with maker() as db:
        with pytest.raises(HTTPException) as off:
            await svc.resend_site(db, str(other_tid), ADMIN, other_sid)
    assert (unapproved.value.status_code, foreign.value.status_code, off.value.status_code) == (409, 404, 409)
    assert await _outbox_count(engine, sid) == 0


# ── Shared from the Legal push ───────────────────────────────────────────


async def test_backfill_and_resend_include_a_pushed_site_without_a_ca_code(engine, maker):  # noqa: F811
    tid, sid, _ = await _setup(engine, maker, ca_code=None, status="legal_review")
    async with maker() as db:
        out = await svc.backfill(db, str(tid), ADMIN)
        await db.commit()
    assert out == {"eligible": 1, "queued": 0}  # counted, and already queued by _setup
    async with _client(lambda r: httpx.Response(200)) as client:
        await _drain(client)  # Send again waits until that update has gone out
    async with maker() as db:
        resent = await svc.resend_site(db, str(tid), ADMIN, sid)
        await db.commit()
    assert resent["queued"] is True and resent["site"]["code"] is None
    assert await _outbox_count(engine, sid) == 2


async def test_resend_before_the_legal_push_explains_why(engine, maker):  # noqa: F811
    tid, sid, _ = await _setup(engine, maker, ca_code=None, status="loi_uploaded")
    async with maker() as db:
        with pytest.raises(HTTPException) as exc:
            await svc.resend_site(db, str(tid), ADMIN, sid)
    assert exc.value.status_code == 409
    assert "hasn't been sent to Legal yet" in exc.value.detail
    assert await _outbox_count(engine, sid) == 0


async def test_backfill_sends_the_final_update_for_a_site_archived_while_off(engine, maker):  # noqa: F811
    tid, sid, _ = await _setup(engine, maker, ca_code=None, status="legal_review")
    async with maker() as db:
        await svc.save_config(db, str(tid), ADMIN, "https://nso.example.com/hook", False)
        await db.commit()
        site = await db.get(models.Site, sid)
        site.status = "archived"  # sending is off: nothing is queued
        await db.commit()
    assert await _outbox_count(engine, sid) == 1
    async with maker() as db:
        await svc.save_config(db, str(tid), ADMIN, "https://nso.example.com/hook", True)
        await db.commit()
    async with maker() as db:
        first = await svc.backfill(db, str(tid), ADMIN)
        await db.commit()
    async with maker() as db:
        again = await svc.backfill(db, str(tid), ADMIN)
        await db.commit()
    rows = await _outbox(engine, sid)
    assert [r.payload["site"]["status"] for r in rows] == ["legal_review", "archived"]
    assert (first["queued"], again["queued"]) == (1, 0)  # the final update once, then nothing


# ── One row per site, and its history ─────────────────────────────────────


async def test_sites_list_has_one_row_per_site_with_its_state(engine, maker):  # noqa: F811
    tid, sid, _ = await _setup(engine, maker)
    other_tid, other_sid, _ = await _setup(engine, maker)
    async with _client(lambda r: httpx.Response(200)) as client:
        await _drain(client)
    async with maker() as db:
        site = await db.get(models.Site, sid)
        site.name = "Renamed"
        await db.commit()
        await svc.send_test(db, str(tid), ADMIN)
        await svc.send_test(db, str(tid), ADMIN)
        await db.commit()
    async with maker() as db:
        listed = await svc.list_sites(db, str(tid))
        found = await svc.list_sites(db, str(tid), "renam")
        literal = await svc.list_sites(db, str(tid), "%")
        other = await svc.list_sites(db, str(other_tid))
    rows = {r["site_id"]: r for r in listed["sites"]}
    assert listed["total"] == 2 and set(rows) == {str(sid), str(svc.TEST_SITE_ID)}
    mine = rows[str(sid)]
    assert mine["events"] == 2
    assert mine["site"]["name"] == "Renamed"
    assert mine["first_sent_at"] is not None  # the first event went out
    assert mine["state"] == "sending" and mine["latest"]["status"] == "pending"
    tests = rows[str(svc.TEST_SITE_ID)]
    assert tests["site"] is None and tests["events"] == 2
    assert [r["site_id"] for r in found["sites"]] == [str(sid)]  # search leaves the test row out
    assert literal["sites"] == []  # "%" is matched literally
    assert [r["site_id"] for r in other["sites"]] == [str(other_sid)]  # other workspace only


async def test_site_history_says_what_changed_and_each_reply(engine, maker):  # noqa: F811
    tid, sid, _ = await _setup(engine, maker)
    async with _client(lambda r: httpx.Response(200)) as client:
        await _drain(client)
    async with maker() as db:
        site = await db.get(models.Site, sid)
        site.name = "Renamed"
        await db.commit()
    async with _client(lambda r: httpx.Response(400, text=REJECTION)) as client:
        await _drain(client)
    async with maker() as db:
        history = await svc.site_history(db, str(tid), sid)
        listed = _only(r for r in (await svc.list_sites(db, str(tid)))["sites"] if r["site_id"] == str(sid))
        with pytest.raises(HTTPException) as other_tenant:
            await svc.site_history(db, str(uuid.uuid4()), sid)
    newest, first = history["events"]
    assert history["state"] == "gave_up" and listed["state"] == "gave_up"
    assert history["reason"] is None and history["site"]["name"] == "Renamed"
    assert {"field": "site.name", "from": "Queued", "to": "Renamed"} in newest["changes"]
    assert newest["first"] is False and newest["status"] == "dead"
    assert newest["tries"][0]["response_snippet"] == REJECTION
    assert first["first"] is True and first["changes"] is None
    assert [t["http_status"] for t in first["tries"]] == [200]
    assert other_tenant.value.status_code == 404


async def test_resend_refuses_while_an_update_is_still_on_its_way(engine, maker):  # noqa: F811
    tid, sid, _ = await _setup(engine, maker)  # leaves one pending event
    async with maker() as db:
        with pytest.raises(HTTPException) as exc:
            await svc.resend_site(db, str(tid), ADMIN, sid)
    assert exc.value.status_code == 409
    assert "already on its way" in exc.value.detail
    assert await _outbox_count(engine, sid) == 1


async def test_first_event_nso_rejected_does_not_count_as_first_sent(engine, maker):  # noqa: F811
    """Like the 18 production sites whose first event died on 2026-11-24."""
    tid, sid, _ = await _setup(engine, maker)
    async with _client(lambda r: httpx.Response(400, text=REJECTION)) as client:
        await _drain(client)  # #1 dead
    async with maker() as db:
        await svc.resend_site(db, str(tid), ADMIN, sid)  # #2: the re-send after deploy
        await db.commit()
    async with _client(lambda r: httpx.Response(200)) as client:
        await _drain(client)
    async with maker() as db:
        site = await db.get(models.Site, sid)
        site.name = "Renamed"  # #3, #4: later updates
        await db.commit()
        site.name = "Renamed again"
        await db.commit()
    async with _client(lambda r: httpx.Response(200)) as client:
        await _drain(client)
    async with maker() as db:
        history = await svc.site_history(db, str(tid), sid)
    *_, resent, dead = history["events"]
    assert dead["status"] == "dead" and dead["first"] is False
    assert resent["first"] is True and resent["changes"] is None  # not "Sent again (no change)"

    async with engine.begin() as conn:
        await conn.execute(text(
            "update integration_outbox set sent_at = now() - interval '40 days' where site_id = :s and status = 'sent'"
        ), {"s": sid})
    await sender.purge_all_sent()
    rows = await _outbox(engine, sid)
    # Kept: the dead one (never purged), the first NSO took, and the newest.
    assert [r.payload["site"]["name"] for r in rows] == ["Queued", "Queued", "Renamed again"]
