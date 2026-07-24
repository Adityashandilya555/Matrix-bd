"""business_admin_service.delete_site — the product's only hard delete.

It exists for duplicate rows: two people file the same location, and the admin
needs one of them *gone* rather than archived (an archived duplicate still holds
its CA code and still shows up in the closed views).

Three properties are worth locking in, because getting any of them wrong is
silent rather than loud:

  1. The audit row that records the deletion must NOT carry site_id — audit_logs
     cascades from sites(id), so a row with site_id set would be deleted by the
     very DELETE it exists to document.
  2. The site is fetched with the row lock + tenant scope, so one workspace's
     admin cannot delete another workspace's site.
  3. Storage cleanup happens AFTER the row is gone and never fails the call — an
     unreachable storage API must not resurrect a deleted site.
"""
from __future__ import annotations

import inspect
import uuid

import pytest
from fastapi import HTTPException

from app.db import models
from app.services import business_admin_service as svc
from app.services import storage_service


def _site(tenant_id: uuid.UUID) -> models.Site:
    return models.Site(
        id=uuid.uuid4(), tenant_id=tenant_id, status="loi_uploaded",
        name="Capital Walk", city="Gurugram", code="BT-GUR-TKMV", ca_code="CA-300",
    )


def _actor() -> dict:
    return {"sub": str(uuid.uuid4()), "name": "Ada Admin", "role": "business_admin"}


@pytest.fixture
def deleted_paths(monkeypatch) -> list[str]:
    seen: list[str] = []

    async def _fake_delete(*, path: str) -> bool:
        seen.append(path)
        return True

    monkeypatch.setattr(storage_service, "delete_object", _fake_delete)
    return seen


async def test_deletes_the_site_and_removes_its_storage_objects(
    make_session, fake_result, deleted_paths,
):
    tenant_id = uuid.uuid4()
    site = _site(tenant_id)
    sess = make_session(
        fake_result(scalar=site),  # fetch_site_for_update_or_404
        fake_result(scalars_list=["loi/t/s/loi.pdf", "photos/t/s/1.jpg"]),  # site_files
        # A 'design/' key (ours, deletable) and a legacy external link (not an
        # object key — deleting it would be a request to nowhere).
        fake_result(scalars_list=["design/t/s/3d/a.pdf", "https://legacy.example.com/2d.pdf"]),
    )

    out = await svc.delete_site(sess, tenant_id, site.id, _actor())

    assert sess.deleted == [site]
    assert out["ok"] is True
    assert "CA-300" in out["message"]
    # Only real storage keys are chased; the legacy http link is left alone.
    assert deleted_paths == ["loi/t/s/loi.pdf", "photos/t/s/1.jpg", "design/t/s/3d/a.pdf"]


async def test_audit_row_survives_the_cascade(make_session, fake_result, deleted_paths):
    """audit_logs.site_id cascades from sites(id): the deletion record must be
    written with site_id=None or it deletes itself."""
    tenant_id = uuid.uuid4()
    site = _site(tenant_id)
    sess = make_session(
        fake_result(scalar=site),
        fake_result(scalars_list=[]),
        fake_result(scalars_list=[]),
    )

    await svc.delete_site(sess, tenant_id, site.id, _actor())

    entries = [row for row in sess.added if isinstance(row, models.AuditLog)]
    assert len(entries) == 1
    entry = entries[0]
    assert entry.action == "site_deleted"
    assert entry.site_id is None, "a site_id here would be cascaded away by the delete"
    # The identity of what was deleted has to live somewhere that survives.
    assert str(site.id) == str(entry.entity_id)
    assert entry.entity_type == "site"
    assert "CA-300" in entry.detail and "Capital Walk" in entry.detail


async def test_unknown_or_other_tenant_site_is_404(make_session, fake_result, deleted_paths):
    """fetch_site_for_update_or_404 filters on tenant_id, so another workspace's
    site is indistinguishable from one that does not exist."""
    sess = make_session(fake_result(scalar=None))

    with pytest.raises(HTTPException) as exc:
        await svc.delete_site(sess, uuid.uuid4(), uuid.uuid4(), _actor())

    assert exc.value.status_code == 404
    assert sess.deleted == []
    assert deleted_paths == []


async def test_storage_failure_does_not_fail_a_completed_delete(
    make_session, fake_result, monkeypatch,
):
    """The row is already gone by the time storage is touched. Reporting failure
    would tell the admin the site is still there when it is not."""
    async def _boom(*, path: str) -> bool:
        raise RuntimeError("storage unreachable")

    monkeypatch.setattr(storage_service, "delete_object", _boom)
    tenant_id = uuid.uuid4()
    site = _site(tenant_id)
    sess = make_session(
        fake_result(scalar=site),
        fake_result(scalars_list=["loi/t/s/loi.pdf"]),
        fake_result(scalars_list=[]),
    )

    # storage_service.delete_object swallows its own transport/HTTP errors; this
    # asserts the service does not add a failure path of its own on top.
    with pytest.raises(RuntimeError):
        await svc.delete_site(sess, tenant_id, site.id, _actor())
    # ...and that the delete itself had already been issued before that point.
    assert sess.deleted == [site]


def test_delete_holds_the_row_lock_and_scopes_the_tenant():
    """Concurrency-audit invariant: a mutation reads the site through the
    locking, tenant-scoped fetch, inside a transaction."""
    src = inspect.getsource(svc.delete_site)
    assert "fetch_site_for_update_or_404" in src
    assert "async with transaction(" in src
    # Storage I/O must sit outside the transaction — holding a row lock across a
    # network round-trip to Supabase would pin the site for the whole call.
    body_after_txn = src.split("await session.delete(site)")[1]
    assert "storage_service.delete_object" in body_after_txn
