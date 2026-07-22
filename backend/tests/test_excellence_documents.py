"""Project-excellence document attachments (shared with Financial Closure).

Covers the two pieces of new logic: the generic site-file uploader writing an
``excellence`` row under the ``excellence/`` prefix, and the endpoint's
allow-list guard (PNG/JPEG/PDF, ≤5 MB) rejecting other types before any storage
write.
"""
from __future__ import annotations

import types
import uuid

import pytest
from fastapi import HTTPException

TENANT = str(uuid.uuid4())
SITE_ID = str(uuid.uuid4())


def _site():
    sid = uuid.uuid4()
    return types.SimpleNamespace(
        id=sid, tenant_id=uuid.UUID(TENANT), submitted_by=uuid.uuid4(), assigned_to=None,
    )


def _supervisor():
    return {"sub": str(uuid.uuid4()), "name": "Sup", "role": "supervisor"}


def _executive(sub=None):
    return {"sub": sub or str(uuid.uuid4()), "name": "Exec", "role": "executive"}


async def test_upload_site_file_writes_excellence_row_under_prefix(session, fake_result, monkeypatch):
    import app.services.photo_service as photo_service

    uploads = []

    async def _fake_upload(**kw):
        uploads.append(kw)

    async def _fake_sign(_path, **kw):
        return "https://signed.example/doc"

    monkeypatch.setattr(photo_service, "upload_bytes", _fake_upload)
    monkeypatch.setattr(photo_service, "signed_url", _fake_sign)

    site = _site()
    session.queue(fake_result(scalar=site))  # fetch_site_or_404

    out = await photo_service.svc_upload_site_file(
        session, tenant_id=TENANT, actor=_supervisor(), site_id=str(site.id),
        filename="floor.png", content_type="image/png", file_bytes=b"PNGDATA",
        file_type="excellence", path_prefix="excellence", audit_action="upload_excellence_doc",
    )

    site_files = [o for o in session.added if type(o).__name__ == "SiteFile"]
    assert len(site_files) == 1
    assert site_files[0].file_type == "excellence"
    assert site_files[0].storage_path.startswith(f"excellence/{TENANT}/")
    # The storage write used the same excellence-prefixed key.
    assert uploads and uploads[0]["path"].startswith(f"excellence/{TENANT}/")
    assert out["url"] == "https://signed.example/doc"
    assert out["file_name"] == "floor.png"


async def test_upload_endpoint_rejects_disallowed_type_before_storage(session, monkeypatch):
    from app.routers import project_excellence as pe

    called = {"upload": False}

    async def _boom(*a, **k):
        called["upload"] = True

    # If the guard fails, this would run — assert it never does.
    monkeypatch.setattr("app.services.photo_service.svc_upload_site_file", _boom)

    # PNG/JPEG/PDF are allowed; a GIF (or anything else) must be rejected up front.
    gif = types.SimpleNamespace(content_type="image/gif", filename="x.gif")
    with pytest.raises(HTTPException) as exc:
        await pe.upload_excellence_document(
            site_id=SITE_ID, db=session, current_user=_supervisor(),
            tenant_id=TENANT, file=gif,
        )
    assert exc.value.status_code == 415
    assert called["upload"] is False


async def test_upload_endpoint_rejects_oversize_before_storage(session, monkeypatch):
    from app.routers import project_excellence as pe

    called = {"upload": False}

    async def _boom(*a, **k):
        called["upload"] = True

    monkeypatch.setattr("app.services.photo_service.svc_upload_site_file", _boom)

    # An allowed type but a declared size over the 5 MB cap → 413 on the fast path.
    big = types.SimpleNamespace(content_type="image/png", filename="big.png", size=6 * 1024 * 1024)
    with pytest.raises(HTTPException) as exc:
        await pe.upload_excellence_document(
            site_id=SITE_ID, db=session, current_user=_supervisor(),
            tenant_id=TENANT, file=big, kind="excellence",
        )
    assert exc.value.status_code == 413
    assert called["upload"] is False


async def test_upload_closure_kind_writes_closure_row_under_prefix(session, fake_result, monkeypatch):
    import app.services.photo_service as photo_service

    async def _fake_upload(**kw):
        return None

    async def _fake_sign(_path, **kw):
        return "https://signed.example/doc"

    monkeypatch.setattr(photo_service, "upload_bytes", _fake_upload)
    monkeypatch.setattr(photo_service, "signed_url", _fake_sign)

    site = _site()
    session.queue(fake_result(scalar=site), fake_result(scalar=0))  # site, then max-1 count

    await photo_service.svc_upload_site_file(
        session, tenant_id=TENANT, actor=_supervisor(), site_id=str(site.id),
        filename="closure.pdf", content_type="application/pdf", file_bytes=b"PDF",
        file_type="closure", path_prefix="closure", audit_action="upload_closure_doc",
        max_count=1, delegation_modules=("financial_closure",),
    )
    rows = [o for o in session.added if type(o).__name__ == "SiteFile"]
    assert len(rows) == 1
    assert rows[0].file_type == "closure"
    assert rows[0].storage_path.startswith(f"closure/{TENANT}/")


async def test_upload_second_file_same_kind_is_409_before_storage(session, fake_result, monkeypatch):
    import app.services.photo_service as photo_service

    called = {"upload": False}

    async def _boom(**kw):
        called["upload"] = True

    monkeypatch.setattr(photo_service, "upload_bytes", _boom)

    site = _site()
    # fetch_site_or_404 → site; max-1 count query → 1 existing row (>= max_count).
    session.queue(fake_result(scalar=site), fake_result(scalar=1))
    with pytest.raises(HTTPException) as exc:
        await photo_service.svc_upload_site_file(
            session, tenant_id=TENANT, actor=_supervisor(), site_id=str(site.id),
            filename="second.png", content_type="image/png", file_bytes=b"PNG",
            file_type="excellence", path_prefix="excellence", max_count=1,
        )
    assert exc.value.status_code == 409
    assert called["upload"] is False


async def test_delegated_executive_may_upload(session, fake_result, monkeypatch):
    """A PE executive holding the site via SiteDelegation (not assigned_to) must
    pass the doc-access gate — the plain ownership check alone 403s them."""
    import app.services.photo_service as photo_service
    import app.services.site_documents_service as sd

    async def _fake_upload(**kw):
        return None

    async def _fake_sign(_path, **kw):
        return "https://signed.example/doc"

    async def _delegated(*a, **k):
        return True

    monkeypatch.setattr(photo_service, "upload_bytes", _fake_upload)
    monkeypatch.setattr(photo_service, "signed_url", _fake_sign)
    monkeypatch.setattr(sd, "svc_is_delegated", _delegated)

    site = _site()  # exec is neither submitted_by nor assigned_to
    session.queue(fake_result(scalar=site), fake_result(scalar=0))  # site, count
    out = await photo_service.svc_upload_site_file(
        session, tenant_id=TENANT, actor=_executive(), site_id=str(site.id),
        filename="floor.png", content_type="image/png", file_bytes=b"PNG",
        file_type="excellence", path_prefix="excellence",
        max_count=1, delegation_modules=("project_excellence",),
    )
    assert out["file_name"] == "floor.png"
    assert any(type(o).__name__ == "SiteFile" for o in session.added)


async def test_undelegated_executive_upload_is_403(session, fake_result, monkeypatch):
    import app.services.photo_service as photo_service
    import app.services.site_documents_service as sd

    async def _not_delegated(*a, **k):
        return False

    monkeypatch.setattr(sd, "svc_is_delegated", _not_delegated)
    site = _site()
    session.queue(fake_result(scalar=site))
    with pytest.raises(HTTPException) as exc:
        await photo_service.svc_upload_site_file(
            session, tenant_id=TENANT, actor=_executive(), site_id=str(site.id),
            filename="x.png", content_type="image/png", file_bytes=b"PNG",
            file_type="excellence", path_prefix="excellence",
            delegation_modules=("project_excellence",),
        )
    assert exc.value.status_code == 403


# ── Delete ────────────────────────────────────────────────────────────────────

async def test_delete_document_removes_row_audits_and_purges_storage(session, fake_result, monkeypatch):
    import app.services.site_documents_service as sd

    audited = {}
    purged = {}

    async def _audit(_s, **kw):
        audited.update(kw)

    async def _delete_object(*, path):
        purged["path"] = path
        return True

    monkeypatch.setattr(sd, "write_audit_event", _audit)
    monkeypatch.setattr(sd.storage_service, "delete_object", _delete_object)

    site = _site()
    file_id = uuid.uuid4()
    row = types.SimpleNamespace(
        id=file_id, storage_path=f"excellence/{TENANT}/x.png",
        file_name="x.png", file_type="excellence",
    )
    session.queue(fake_result(scalar=site), fake_result(scalar=row))
    out = await sd.svc_delete_site_document(
        session, tenant_id=TENANT, actor=_supervisor(), site_id=str(site.id), file_id=str(file_id),
    )
    assert out["ok"] is True
    assert "DELETE" in session.sql.upper()               # row deleted
    assert audited.get("action") == "delete_excellence_doc"
    assert purged.get("path") == f"excellence/{TENANT}/x.png"  # storage purged after commit


async def test_delete_unknown_document_is_404(session, fake_result):
    import app.services.site_documents_service as sd

    site = _site()
    session.queue(fake_result(scalar=site), fake_result(scalar=None))  # site, then no row
    with pytest.raises(HTTPException) as exc:
        await sd.svc_delete_site_document(
            session, tenant_id=TENANT, actor=_supervisor(),
            site_id=str(site.id), file_id=str(uuid.uuid4()),
        )
    assert exc.value.status_code == 404


def test_delete_scoped_to_excellence_and_closure_only():
    """The delete service must never be able to reach LOIs, photos, or QA
    reports — its allowed_types default is exactly the two budget kinds."""
    import inspect
    from app.services.site_documents_service import svc_delete_site_document
    sig = inspect.signature(svc_delete_site_document)
    assert sig.parameters["allowed_types"].default == ("excellence", "closure")


# ── Pagination parity ─────────────────────────────────────────────────────────

async def test_budget_admin_queue_total_is_full_count_not_page_len(session, fake_result, monkeypatch):
    import app.services.project_excellence_service as pe

    async def _count(_s, _stmt):
        return 7  # 7 match the filter overall…

    async def _prefetch(_s, _sites):
        return {}, {}

    monkeypatch.setattr(pe, "count_rows", _count)
    monkeypatch.setattr(pe, "_batch_pe_prefetch", _prefetch)
    session.queue(fake_result(all_rows=[]))  # …but this page returns no rows
    out = await pe.svc_pe_budget_admin_queue(session, tenant_id=TENANT, limit=2, offset=10)
    assert out.total == 7          # full count, not len(items)
    assert out.items == []
