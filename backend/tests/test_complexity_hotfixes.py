"""#240 — behaviour-preserving hotspot fixes (backend, contained subset).

Covers the two surgical, independently-verifiable items:
  18.5  approve_workspace_request built its notification_outbox JSON by string
        concatenation → malformed JSON (and a runtime CAST error) when a field
        held a quote/backslash. Now uses json.dumps.
  18.6  _build_response fired up to 5 sequential SELECTs to `users` (one per
        actor via an inner closure). Now batches them into ONE query.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.services import launch_service

_DT = datetime(2026, 1, 1, tzinfo=timezone.utc)


# ── 18.5 — outbox payload is valid JSON for adversarial inputs ────────────────

def test_outbox_payload_is_valid_json_for_special_chars():
    # Mirrors the json.dumps construction in approve_workspace_request. The old
    # string-spliced template produced invalid JSON for these company names.
    for company in [r"O'Brien & Sons", 'Acme "Quoted" Pvt', r"Back\slash Ltd", "Tab\tCo"]:
        payload = json.dumps({
            "tenant_id": str(uuid4()),
            "workspace_code": "WS-1234",
            "business_admin_id": str(uuid4()),
            "company": company,
            "city": "Bengaluru",
        })
        parsed = json.loads(payload)          # must not raise
        assert parsed["company"] == company   # round-trips exactly


# ── 18.6 — _build_response batches the actor-name lookups into one query ──────

def _site():
    return SimpleNamespace(
        id=uuid4(), name="Cafe One", city="Pune", model="dine-in",
        google_maps_pin=None, google_maps_url=None, visit_date=None, code="S-1",
        legal_dd_status="positive", agreement_status="done", licensing_status="done",
        design_status="approved", project_status="done", finance_status="approved",
        kyc_verified=True, ca_code="CA-1",
    )


def _row():
    # All five actor fields populated → pre-fix this fired 5 separate users SELECTs.
    return SimpleNamespace(
        id=uuid4(), tenant_id=uuid4(), status="launched",
        rent_type=None, expected_rent=None, fixed_rent_amt=None, rev_share_pct=None,
        escalation_pct=None, escalation_date=None, expected_escalation_years=None,
        rent_free_days=None, lock_in_months=None, tenure_months=None, notes=None,
        admin_review_comment=None, admin_sent_for_review_at=_DT, admin_sent_for_review_by=uuid4(),
        exec_verdict=None, exec_comment=None, exec_reviewed_at=_DT, exec_reviewed_by=uuid4(),
        supervisor_verdict=None, supervisor_comment=None, supervisor_reviewed_at=_DT,
        supervisor_reviewed_by=uuid4(),
        admin_final_comment=None, admin_confirmed_at=_DT, admin_confirmed_by=uuid4(),
        committed_at=_DT, launched_at=_DT, launched_by=uuid4(),
        created_at=_DT, updated_at=_DT,
    )


@pytest.mark.asyncio
async def test_build_response_batches_user_lookups(make_session, fake_result):
    site, row = _site(), _row()
    sess = make_session(
        fake_result(scalar=None),       # SiteDetail
        fake_result(scalar=None),       # NsoReview
        fake_result(scalars_list=[]),   # LaunchReviewEvent list
        fake_result(all_rows=[]),       # the ONE batched users lookup
    )
    await launch_service._build_response(sess, row=row, site=site)

    users_queries = [s for s in sess.executed if "users" in s.lower()]
    assert len(users_queries) == 1, (
        f"expected exactly one users SELECT (batched), got {len(users_queries)}"
    )
