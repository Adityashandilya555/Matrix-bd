"""#235 — set_tenant_branding must release the DB connection before the upload.

The handler runs a `SELECT` (which auto-begins a read transaction on the
session) and then `await`s a storage upload (up to 30s) before the `UPDATE` +
commit — holding a connection / scarce pgBouncer slot across slow external I/O.
The fix mirrors the #89 LOI/photo/design pattern: `await db.rollback()` after the
existence check, before the upload.

We can't observe real auto-begin through the DB-free `RecordingSession`, so we
assert the **ordering** instead (the established pattern in this repo's tests):
a rollback must have occurred before `storage_upload` is invoked. Fails on the
pre-fix code (no rollback before upload), passes after.
"""
from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.routers import tenancy


def _stub_admin(monkeypatch):
    monkeypatch.setattr(tenancy, "_require_platform_admin", lambda *a, **k: None)


async def _fake_read(_upload):
    return b"PNGDATA"


@pytest.mark.asyncio
async def test_rollback_precedes_storage_upload(monkeypatch, make_session, fake_result):
    _stub_admin(monkeypatch)
    monkeypatch.setattr(tenancy, "read_upload_capped", _fake_read)

    session = make_session(fake_result(mappings_rows=[
        {"id": uuid4(), "name": "Acme", "logo_url": None},
    ]))

    captured = {}

    async def _probe_upload(*, path, body, content_type):
        # Record how many rollbacks had fired at the moment of the upload.
        captured["rollbacks_before_upload"] = session.rollback_count

    monkeypatch.setattr(tenancy, "storage_upload", _probe_upload)

    logo = SimpleNamespace(filename="logo.png", content_type="image/png")
    out = await tenancy.set_tenant_branding(
        "11111111-1111-1111-1111-111111111111", session,
        name="Acme New", logo=logo, x_platform_admin_key="k",
    )

    # The connection's read txn was released before the slow upload ran.
    assert captured["rollbacks_before_upload"] >= 1
    # And the write still persisted + committed afterwards.
    assert out["name"] == "Acme New"
    assert out["has_logo"] is True
    assert session.commit_count >= 1


@pytest.mark.asyncio
async def test_unknown_tenant_404_before_any_upload(monkeypatch, make_session, fake_result):
    _stub_admin(monkeypatch)
    monkeypatch.setattr(tenancy, "read_upload_capped", _fake_read)

    uploaded = {"called": False}

    async def _probe_upload(*, path, body, content_type):
        uploaded["called"] = True

    monkeypatch.setattr(tenancy, "storage_upload", _probe_upload)

    session = make_session(fake_result(mappings_rows=[]))  # tenant not found
    logo = SimpleNamespace(filename="logo.png", content_type="image/png")

    with pytest.raises(tenancy.HTTPException) as exc:
        await tenancy.set_tenant_branding(
            "deadbeef-0000-0000-0000-000000000000", session,
            name="X", logo=logo, x_platform_admin_key="k",
        )
    assert exc.value.status_code == 404
    assert uploaded["called"] is False
