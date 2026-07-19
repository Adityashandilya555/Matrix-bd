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

import filetype
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


async def test_read_capped_allows_legacy_office_and_csv():
    # Regression for #177's allowlist being too narrow: the LOI input accepts
    # .doc, and project/design deliverables include legacy .xls and CSV exports.
    for ct in (
        "application/msword",                # .doc
        "application/vnd.ms-excel",          # .xls
        "text/csv",                          # .csv
        "image/heic",                        # iPhone photo via image/* input
    ):
        file = _FakeUploadWithMime(b"hello", content_type=ct)
        assert await read_upload_capped(file, max_bytes=100) == b"hello"


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


# ── #226 — magic-byte validation (declared Content-Type is spoofable) ──────
_PNG = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR" + b"\x00" * 64
_JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01" + b"\x00" * 64
_PDF = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n" + b"x" * 64


def _docx_bytes() -> bytes:
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(
            "[Content_Types].xml",
            "<Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'>"
            "<Override PartName='/word/document.xml' ContentType='application/vnd."
            "openxmlformats-officedocument.wordprocessingml.document.main+xml'/></Types>",
        )
        z.writestr("word/document.xml", "<doc/>")
    return buf.getvalue()


async def test_read_capped_rejects_png_body_declared_as_pdf():
    # PROVE-FIRST: pre-fix this returned the bytes (spoofed type accepted);
    # after the magic-byte check it must be 415.
    file = _FakeUploadWithMime(_PNG, content_type="application/pdf")
    with pytest.raises(HTTPException) as ei:
        await read_upload_capped(file, max_bytes=1000)
    assert ei.value.status_code == 415


async def test_read_capped_rejects_jpeg_body_declared_as_png():
    file = _FakeUploadWithMime(_JPEG, content_type="image/png")
    with pytest.raises(HTTPException) as ei:
        await read_upload_capped(file, max_bytes=1000)
    assert ei.value.status_code == 415


async def test_read_capped_accepts_genuine_pdf():
    file = _FakeUploadWithMime(_PDF, content_type="application/pdf")
    assert await read_upload_capped(file, max_bytes=1000) == _PDF


async def test_read_capped_accepts_genuine_png():
    file = _FakeUploadWithMime(_PNG, content_type="image/png")
    assert await read_upload_capped(file, max_bytes=1000) == _PNG


async def test_read_capped_accepts_genuine_docx():
    data = _docx_bytes()
    ct = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    file = _FakeUploadWithMime(data, content_type=ct)
    assert await read_upload_capped(file, max_bytes=10_000) == data


async def test_read_capped_csv_not_byte_checked():
    # text/csv has no reliable magic — must pass on the allowlist alone so real
    # CSV exports are never rejected (#226, 4.2).
    csv = b"site_code,city\nBD-1,Mumbai\n"
    file = _FakeUploadWithMime(csv, content_type="text/csv")
    assert await read_upload_capped(file, max_bytes=1000) == csv


async def test_read_capped_allows_zip_declared_as_docx_with_warning():
    # Deliberate trade-off (#226 / #244 review): a body that sniffs as the generic
    # application/zip is allow-with-warning when declared as OOXML, because a
    # genuine, validly-packed .docx/.xlsx whose markers fall past filetype's ~6 KB
    # scan window is byte-indistinguishable from a plain ZIP. Rejecting it (the
    # old behaviour) 415'd real Office uploads. The residual risk — a bare ZIP
    # mislabelled as .docx — is low: the file is served via a signed download URL
    # and never parsed/executed by the backend. A positive mismatch to any OTHER
    # known type (png/pdf/exe) is still rejected (see the tests above).
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("hello.txt", "not an office document")  # sniffs as application/zip
    ct = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    file = _FakeUploadWithMime(buf.getvalue(), content_type=ct)
    assert await read_upload_capped(file, max_bytes=10_000) == buf.getvalue()


async def test_read_capped_accepts_docx_with_markers_past_scan_window():
    # The regression this fix targets: a genuine docx whose `word/` marker sits
    # past filetype's ~6 KB scan window (a large leading customXml/embedded part)
    # sniffs only as application/zip — it must NOT be 415'd.
    import io
    import zipfile

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("customXml/item1.xml", "<x>" + ("y" * 7000) + "</x>")  # >6 KB leading part
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<doc/>")
    data = buf.getvalue()
    # Precondition: filetype can only resolve this to the generic zip container.
    assert filetype.guess(data).mime == "application/zip"
    ct = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    file = _FakeUploadWithMime(data, content_type=ct)
    assert await read_upload_capped(file, max_bytes=20_000) == data


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


async def test_submit_inspection_date_sets_submitted(make_session, monkeypatch):
    # Quality audit is now a calendar DATE (no document upload): the executive
    # records the inspection date, which moves the QA to 'submitted' for the
    # supervisor -> business_admin two-tier sign-off.
    from app.domain.schemas.project import MilestoneRequest

    async def _noop(*a, **k):
        return None

    review = SimpleNamespace(
        mid_project_visit_date=date(2026, 6, 1), inspection_date=None, quality_audit_status=None,
    )
    site = SimpleNamespace(id=uuid4(), tenant_id=uuid4())

    async def _fetch_site(*a, **k):
        return site

    async def _fetch_review(*a, **k):
        return review

    async def _build(*a, **k):
        return "OK"

    monkeypatch.setattr(project_service, "fetch_site_for_update_or_404", _fetch_site)
    monkeypatch.setattr(project_service, "write_audit_event", _noop)
    monkeypatch.setattr(project_service, "_assert_can_work_project", _noop)
    monkeypatch.setattr(project_service, "_fetch_review_or_create", _fetch_review)
    monkeypatch.setattr(project_service, "_build_response", _build)

    sess = make_session()
    out = await project_service.svc_submit_inspection_date(
        sess, tenant_id=site.tenant_id, actor={"sub": "u", "name": "U"}, site_id=site.id,
        body=MilestoneRequest(value=date(2026, 6, 2)),
    )
    assert out == "OK"
    assert review.inspection_date == date(2026, 6, 2)
    assert review.quality_audit_status == "submitted"


class _PgError(Exception):
    """Minimal stand-in for the asyncpg exception behind IntegrityError.orig."""

    def __init__(self, sqlstate: str):
        super().__init__(f"pg error {sqlstate}")
        self.sqlstate = sqlstate


async def test_fetch_review_or_create_idempotent_on_unique_conflict(monkeypatch):
    """#408 follow-up: a lock-free create that loses the race gets a UNIQUE
    violation (SQLSTATE 23505) on flush and must refetch the winner, not 500."""
    from sqlalchemy.exc import IntegrityError

    from app.db import models
    from tests.conftest import RecordingSession

    site = SimpleNamespace(id=uuid4(), tenant_id=uuid4())
    winner = models.ProjectReview(tenant_id=site.tenant_id, site_id=site.id)

    calls = {"n": 0}

    async def _or_none(session, *, site_id):
        calls["n"] += 1
        return None if calls["n"] == 1 else winner  # miss first, winner on refetch

    async def _boom():
        raise IntegrityError("INSERT", {}, _PgError("23505"))

    monkeypatch.setattr(project_service, "_fetch_review_or_none", _or_none)
    session = RecordingSession()
    monkeypatch.setattr(session, "flush", _boom)

    out = await project_service._fetch_review_or_create(session, site=site)
    assert out is winner            # refetched the winner instead of raising
    assert calls["n"] == 2          # missed once, then refetched the winner
    assert session.rollback_count == 1  # the savepoint rolled back the lost insert


async def test_fetch_review_or_create_reraises_non_unique_integrity_error(monkeypatch):
    """A non-unique IntegrityError (NOT NULL / FK / CHECK) must propagate, not be
    masked by the refetch path — this is the narrowed-catch guarantee."""
    from sqlalchemy.exc import IntegrityError

    from tests.conftest import RecordingSession

    site = SimpleNamespace(id=uuid4(), tenant_id=uuid4())

    calls = {"n": 0}

    async def _or_none(session, *, site_id):
        calls["n"] += 1
        return None  # never a winner — this failure is not a race

    async def _boom():
        raise IntegrityError("INSERT", {}, _PgError("23502"))  # NOT NULL violation

    monkeypatch.setattr(project_service, "_fetch_review_or_none", _or_none)
    session = RecordingSession()
    monkeypatch.setattr(session, "flush", _boom)

    with pytest.raises(IntegrityError):
        await project_service._fetch_review_or_create(session, site=site)
    assert calls["n"] == 1  # raised before the refetch — no masking
