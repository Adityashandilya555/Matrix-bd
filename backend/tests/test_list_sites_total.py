"""list_sites `total` must be the true pre-pagination count (#377).

The rows are capped at the page limit (#230) so the response can't grow
unbounded, but the UI derives KPI tiles from `total` — so it has to reflect
the real filtered count, not `len(items)` (which would stick at the page size
once a tenant crosses `limit` sites).
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

from app.services.query_service import list_sites


def _site(**over):
    base = dict(
        id=uuid.uuid4(), tenant_id=uuid.uuid4(), submitted_by=uuid.uuid4(),
        assigned_to=None, supervisor_id=None, code="BT-NEW-1", name="demo", city="Delhi",
        status="shortlisted", visit_date=None, model="cafe", spoc_name="A",
        google_maps_pin=None, google_maps_url=None, expected_rent=100000, rent_type="fixed",
        expected_escalation_pct=5, expected_escalation_years=1, expected_revshare_pct=None,
        area_sqft=800, staggered_escalation=None, legal_dd_status="pending",
        agreement_status="pending", licensing_status="pending", design_status="pending",
        is_launched=False, launched_at=None, finance_status="pending", kyc_verified=False,
        ca_code=None, finance_amount=None, approved_at=None, loi_uploaded_at=None,
        rejection_reason=None, archive_note=None, archived_at=None,
        updated_at=datetime(2026, 7, 1, tzinfo=timezone.utc),
    )
    base.update(over)
    import types
    return types.SimpleNamespace(**base)


def test_total_reflects_true_count_not_page_size(make_session, fake_result):
    tenant_id = uuid.uuid4()
    user = {"sub": str(uuid.uuid4()), "role": "supervisor", "module": "bd"}
    rows = [_site(tenant_id=tenant_id) for _ in range(2)]  # a page holding 2 rows...

    session = make_session(
        fake_result(scalar=250),               # count_rows → true total (> page)
        fake_result(scalars_list=rows),        # page of sites (capped)
        fake_result(scalars_list=[]),          # details
        fake_result(scalars_list=[]),          # projects
        fake_result(scalars_list=[]),          # approvals
        fake_result(scalars_list=[]),          # nso
        fake_result(scalars_list=[]),          # launch
        fake_result(all_rows=[]),              # _resolve_site_names
        fake_result(all_rows=[]),              # compute_unseen_supervisor_edits
    )

    resp = asyncio.run(list_sites(session, tenant_id=tenant_id, user=user))

    assert len(resp.items) == 2          # rows stay bounded by the page limit
    assert resp.total == 250             # ...but total is the true filtered count
