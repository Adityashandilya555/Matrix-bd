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
    # A genuinely closed (archived) site — documents must still be returned with
    # NO status filter. Using a terminal status (not "launched", which a naive
    # "active sites only" filter might still include) makes this fail if closed-
    # site filtering is ever reintroduced.
    site = models.Site(id=uuid.uuid4(), tenant_id=tenant_id, status="archived",
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
    # A LEGACY deliverable whose file_url is a free-text external URL (not a
    # 'design/' storage object) — it must be passed through as a usable link, not
    # signed (signing would fail and drop the Open link).
    legacy = models.DesignDeliverable(
        id=uuid.uuid4(), tenant_id=tenant_id, site_id=site.id, kind="2d",
        file_url="https://legacy.example.com/2d.pdf", file_name="2d.pdf",
        submitted_by=uuid.uuid4(), submitted_at=_dt(1),
    )
    sess = make_session(
        fake_result(scalar=site),         # fetch_site_or_404
        fake_result(scalars_list=[loi]),  # site_files
        fake_result(scalars_list=[recce, legacy]),  # design_deliverables (file_url not null)
    )

    out = await docs.list_site_documents(sess, tenant_id=tenant_id, site_id=site.id)

    assert out["site_id"] == str(site.id)
    # All sources aggregated, with design typed distinctly.
    assert {it["file_type"] for it in out["documents"]} == {"loi", "design_recce", "design_2d"}
    # Newest-first across sources: the recce (1/3) precedes the loi (1/2) and legacy (1/1).
    assert out["documents"][0]["file_type"] == "design_recce"
    assert out["documents"][0]["module"] == "Design"
    by_type = {it["file_type"]: it["url"] for it in out["documents"]}
    # Storage-backed paths (loi, design/ recce) are signed.
    assert by_type["loi"].startswith("https://signed/")
    assert by_type["design_recce"].startswith("https://signed/")
    # The legacy external URL is passed through unchanged (not signed → still openable).
    assert by_type["design_2d"] == "https://legacy.example.com/2d.pdf"
