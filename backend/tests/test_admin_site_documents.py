"""business_admin_documents_service: aggregate every uploaded document for a
site (site_files + design deliverables), signed, even for a closed site."""
from __future__ import annotations

import datetime
import uuid

from app.db import models
from app.services import business_admin_documents_service as docs
from app.services import storage_service


def _dt(day: int) -> datetime.datetime:
    return datetime.datetime(2026, 1, day, tzinfo=datetime.timezone.utc)


async def test_aggregates_site_files_and_design_deliverables(make_session, fake_result, monkeypatch):
    async def _fake_sign(path, *a, **k):
        return f"https://signed/{path}"
    monkeypatch.setattr(storage_service, "signed_url", _fake_sign)

    tenant_id = uuid.uuid4()
    # A CLOSED site — documents must still be returned (no status filter).
    site = models.Site(id=uuid.uuid4(), tenant_id=tenant_id, status="launched",
                       name="Powai", city="Mumbai")
    loi = models.SiteFile(
        id=uuid.uuid4(), tenant_id=tenant_id, site_id=site.id, uploaded_by=uuid.uuid4(),
        file_type="loi", file_name="loi.pdf", storage_path="loi/t/s/loi.pdf",
        uploaded_at=_dt(2),
    )
    recce = models.DesignDeliverable(
        id=uuid.uuid4(), tenant_id=tenant_id, site_id=site.id, kind="recce",
        file_url="design/t/s/recce/r.pdf", file_name="recce.pdf",
        submitted_by=uuid.uuid4(), submitted_at=_dt(3),
    )
    sess = make_session(
        fake_result(scalar=site),         # fetch_site_or_404
        fake_result(scalars_list=[loi]),  # site_files
        fake_result(scalars_list=[recce]),  # design_deliverables (file_url not null)
    )

    out = await docs.list_site_documents(sess, tenant_id=tenant_id, site_id=site.id)

    assert out["site_id"] == str(site.id)
    # Both sources aggregated, with design typed distinctly.
    assert {it["file_type"] for it in out["documents"]} == {"loi", "design_recce"}
    # Newest-first across sources: the recce (1/3) precedes the loi (1/2).
    assert out["documents"][0]["file_type"] == "design_recce"
    assert out["documents"][0]["module"] == "Design"
    # Every storage path is signed.
    assert all(it["url"].startswith("https://signed/") for it in out["documents"])
