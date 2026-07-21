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
