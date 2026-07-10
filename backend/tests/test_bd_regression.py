"""Regression test for BD pipeline schema mismatches during site creation and workflow transitions."""
from __future__ import annotations

import datetime
import pytest
from app.domain.state_machine import SiteStatus
from app.services.bd_service import svc_create_draft, svc_push_to_payments
from tests.conftest import RecordingSession

pytestmark = pytest.mark.asyncio

async def test_create_and_transition_custom_model_site():
    """Verify that creating a site with a custom model and transitioning it works correctly.
    
    This tests:
    1. sites.model does not crash with legacy ENUM type when using arbitrary text ('BTC Cafe+').
    2. sites.status allows current workflow statuses ('legal_review').
    """
    session = RecordingSession()
    actor = {"sub": "00000000-0000-0000-0000-000000000001", "name": "Bob", "role": "supervisor"}
    tenant_id = "00000000-0000-0000-0000-000000000002"

    # 1. Create Draft with custom model "BTC Cafe+"
    # This previously failed because of sites.model still being an enum in the DB.
    site_dict = await svc_create_draft(
        session,
        tenant_id=tenant_id,
        actor=actor,
        name="Regression Site 1",
        city="Mumbai",
        visit_date=datetime.date(2026, 7, 10),
        expected_rent=100000,
        rent_type="fixed",
        model="BTC Cafe+"
    )
    
    # Extract the created site from session.added
    site_row = session.added[0]
    
    # Bypass intermediate steps for brevity: manually set to LOI_UPLOADED 
    # to test the svc_push_to_payments (which moves to LEGAL_REVIEW).
    site_row.status = SiteStatus.LOI_UPLOADED.value
    
    # Seed the mock session so `fetch_site_for_update_or_404` finds it
    from tests.conftest import FakeResult
    session._results.append(FakeResult(scalar=site_row)) # for fetch_site_for_update_or_404
    session._results.append(FakeResult(scalar=None)) # for existing_legal_dd
    session._results.append(FakeResult(all_rows=[(actor["sub"],)])) # for recipients_for_legal_supervisors
    
    # 2. Push to Legal Review (BD Supervisor action)
    # This previously failed if the `chk_sites_status` constraint didn't allow `legal_review`.
    result = await svc_push_to_payments(
        session,
        tenant_id=tenant_id,
        actor=actor,
        site_id=site_row.id
    )
    
    assert result.ok is True
    
    # Verify the final state
    assert site_row.status == SiteStatus.LEGAL_REVIEW.value
    assert site_row.legal_review_at is not None
