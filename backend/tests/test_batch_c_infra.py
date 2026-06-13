"""Batch C — backend infra / performance (P0/P1).

Covers:
  #90 asyncpg engine has command + connect timeouts
  #92 storage_service translates transport/JSON failures (no unhandled 500)
  #93 read_upload_capped enforces a hard size cap (413)
  #89 LOI + quality-audit uploads run OUTSIDE the DB transaction
"""
from __future__ import annotations

from datetime import date
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy.pool import NullPool

from app.core.uploads import read_upload_capped
from app.db.session import _build_engine_kwargs
from app.services import loi_service, project_service, storage_service


# ── #90 — engine timeouts ──────────────────────────────────────────────────

def test_pooler_engine_kwargs_have_timeouts():
    kw = _build_engine_kwargs("postgresql+asyncpg://u:p@db.pooler.supabase.com:6543/postgres")
    ca = kw["connect_args"]
    assert ca["command_timeout"] > 0
    assert ca["timeout"] > 0
    assert ca["statement_cache_size"] == 0  # still pgBouncer-safe
    assert kw["poolclass"] is NullPool


def test_direct_engine_kwargs_have_timeouts():
    kw = _build_engine_kwargs("postgresql+asyncpg://u:p@localhost:5432/postgres")
    ca = kw["connect_args"]
    assert ca["command_timeout"] > 0
    assert ca["timeout"] > 0


# ── #93 — upload size cap ──────────────────────────────────────────────────

class _FakeUpload:
    def __init__(self, data: bytes, size=None):
        self._data = data
        self.size = size
        self._pos = 0

    async def read(self, n: int = -1) -> bytes:
        if n is None or n < 0:
            chunk = self._data[self._pos:]
            self._pos = len(self._data)
            return chunk
        chunk = self._data[self._pos:self._pos + n]
        self._pos += len(chunk)
        return chunk


async def test_read_capped_under_limit_returns_body():
    out = await read_upload_capped(_FakeUpload(b"x" * 100, size=100), max_bytes=1000)
    assert out == b"x" * 100


async def test_read_capped_declared_oversize_413():
    with pytest.raises(HTTPException) as ei:
        await read_upload_capped(_FakeUpload(b"x" * 10, size=999_999), max_bytes=1000)
    assert ei.value.status_code == 413


async def test_read_capped_stream_overflow_413():
    # Absent/lying declared size; the stream itself exceeds the cap.
    big = b"x" * (3 * 1024 * 1024)
    with pytest.raises(HTTPException) as ei:
        await read_upload_capped(_FakeUpload(big, size=None), max_bytes=1024 * 1024)
    assert ei.value.status_code == 413


class _FakeUploadWithMime:
    def __init__(self, data: bytes, content_type: str | None = None, size=None):
        self._data = data
        self.content_type = content_type
        self.size = size
        self._pos = 0

    async def read(self, n: int = -1) -> bytes:
        if n is None or n < 0:
            chunk = self._data[self._pos:]
            self._pos = len(self._data)
            return chunk
        chunk = self._data[self._pos:self._pos + n]
        self._pos += len(chunk)
        return chunk


async def test_read_capped_allowed_mime():
    file = _FakeUploadWithMime(b"hello", content_type="image/png")
    out = await read_upload_capped(file, max_bytes=100)
    assert out == b"hello"


async def test_read_capped_disallowed_mime_415():
    file = _FakeUploadWithMime(b"hello", content_type="application/x-msdownload")
    with pytest.raises(HTTPException) as ei:
        await read_upload_capped(file, max_bytes=100)
    assert ei.value.status_code == 415


async def test_read_capped_upload_file_missing_mime():
    from fastapi import UploadFile
    import io
    # UploadFile without Content-Type header should raise 400
    file = UploadFile(io.BytesIO(b"hello"), filename="test.png")
    with pytest.raises(HTTPException) as ei:
        await read_upload_capped(file, max_bytes=100)
    assert ei.value.status_code == 400
    assert "Missing or empty Content-Type header" in ei.value.detail


async def test_read_capped_upload_file_valid_mime():
    from fastapi import UploadFile
    from starlette.datastructures import Headers
    import io
    # UploadFile with valid Content-Type header should pass
    file = UploadFile(
        io.BytesIO(b"hello"),
        filename="test.png",
        headers=Headers({"content-type": "image/png"})
    )
    out = await read_upload_capped(file, max_bytes=100)
    assert out == b"hello"


# ── #92 — storage error handling ───────────────────────────────────────────

def _configure_storage(monkeypatch):
    monkeypatch.setattr(storage_service.settings, "supabase_project_url", "https://x.supabase.co")
    monkeypatch.setattr(storage_service.settings, "supabase_service_role_key", "key")


class _RaisingClient:
    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def put(self, *a, **k):
        raise httpx.ConnectError("storage down")

    async def post(self, *a, **k):
        raise httpx.ConnectError("storage down")


async def test_upload_bytes_transport_error_is_502(monkeypatch):
    _configure_storage(monkeypatch)
    monkeypatch.setattr(storage_service.httpx, "AsyncClient", _RaisingClient)
    with pytest.raises(HTTPException) as ei:
        await storage_service.upload_bytes(path="p", body=b"x", content_type="application/pdf")
    assert ei.value.status_code == 502


async def test_signed_url_transport_error_degrades_to_none(monkeypatch):
    _configure_storage(monkeypatch)
    monkeypatch.setattr(storage_service.httpx, "AsyncClient", _RaisingClient)
    assert await storage_service.signed_url("p") is None


class _BadJsonClient:
    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, *a, **k):
        class _R:
            status_code = 200

            def json(self):
                raise ValueError("not json")

        return _R()


async def test_signed_url_non_json_body_degrades_to_none(monkeypatch):
    _configure_storage(monkeypatch)
    monkeypatch.setattr(storage_service.httpx, "AsyncClient", _BadJsonClient)
    assert await storage_service.signed_url("p") is None


# ── #89 — uploads run OUTSIDE the DB transaction ───────────────────────────

async def test_loi_upload_runs_outside_transaction(make_session, fake_result, monkeypatch):
    captured = {}

    async def fake_upload(*, path, body, content_type):
        captured["in_txn"] = sess.in_transaction()

    async def _noop(*a, **k):
        return None

    async def _no_recipients(*a, **k):
        return []

    monkeypatch.setattr(loi_service, "upload_bytes", fake_upload)
    monkeypatch.setattr(loi_service, "write_audit_event", _noop)
    monkeypatch.setattr(loi_service, "recipients_for_supervisors", _no_recipients)
    monkeypatch.setattr(loi_service, "notify_enqueue", _noop)

    site = SimpleNamespace(
        id=uuid4(), tenant_id=uuid4(), status="approved",
        submitted_by="s1", assigned_to=None, approved_at=None, loi_uploaded_at=None,
    )
    sess = make_session(fake_result(scalar=site), fake_result(scalar=site))

    await loi_service.svc_upload_loi(
        sess, tenant_id=site.tenant_id,
        actor={"sub": "sup", "role": "supervisor", "name": "S"},
        site_id=site.id, filename="loi.pdf", content_type="application/pdf", file_bytes=b"x",
    )
    assert captured["in_txn"] is False


async def test_quality_audit_upload_runs_outside_transaction(make_session, fake_result, monkeypatch):
    captured = {}

    async def fake_upload(*, path, body, content_type):
        captured["in_txn"] = sess.in_transaction()

    async def _noop(*a, **k):
        return None

    review = SimpleNamespace(
        mid_project_visit_date=date(2026, 6, 1), inspection_date=None, quality_audit_status=None,
    )

    async def _fetch_review(*a, **k):
        return review

    async def _build(*a, **k):
        return "OK"

    monkeypatch.setattr(project_service, "upload_bytes", fake_upload)
    monkeypatch.setattr(project_service, "write_audit_event", _noop)
    monkeypatch.setattr(project_service, "_assert_can_work_project", _noop)
    monkeypatch.setattr(project_service, "_fetch_review_or_create", _fetch_review)
    monkeypatch.setattr(project_service, "_build_response", _build)

    site = SimpleNamespace(id=uuid4(), tenant_id=uuid4())
    sess = make_session(fake_result(scalar=site), fake_result(scalar=site))

    out = await project_service.svc_submit_quality_audit_report(
        sess, tenant_id=site.tenant_id, actor={"sub": "u", "name": "U"}, site_id=site.id,
        filename="qa.pdf", content_type="application/pdf", file_bytes=b"x",
        inspection_date=date(2026, 6, 2),
    )
    assert captured["in_txn"] is False
    assert out == "OK"
