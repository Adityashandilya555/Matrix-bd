"""Tests for staggered rent type and area_sqft fields on pipeline draft creation."""
from __future__ import annotations

import pytest
from app.services.bd_service import svc_create_draft
from tests.conftest import RecordingSession

pytestmark = pytest.mark.asyncio

async def test_staggered_rent_sets_staggered_escalation():
    """When rent_type is 'staggered', staggered_escalation should be stored."""
    session = RecordingSession()
    actor = {"sub": "00000000-0000-0000-0000-000000000001", "name": "Bob", "role": "executive"}
    
    staggered_payload = [
        {"year": 1, "percent": 5.0},
        {"year": 2, "percent": 5.5}
    ]

    response = await svc_create_draft(
        session,
        tenant_id="00000000-0000-0000-0000-000000000002",
        actor=actor,
        name="Test Site",
        city="Mumbai",
        visit_date="2026-07-10",
        expected_rent=100000,
        rent_type="staggered",
        staggered_escalation=staggered_payload,
        area_sqft=1500,
    )
    
    # Extract the created site from session.added
    site = session.added[0]
    
    assert site.rent_type == "staggered"
    assert site.staggered_escalation == staggered_payload
    assert site.area_sqft == 1500

async def test_staggered_rent_guard_clears_escalation_if_wrong_rent_type():
    """If staggered_escalation is passed but rent_type is NOT 'staggered', it should be dropped."""
    session = RecordingSession()
    actor = {"sub": "00000000-0000-0000-0000-000000000001", "name": "Bob", "role": "executive"}
    
    staggered_payload = [
        {"year": 1, "percent": 5.0},
    ]

    response = await svc_create_draft(
        session,
        tenant_id="00000000-0000-0000-0000-000000000002",
        actor=actor,
        name="Test Site",
        city="Mumbai",
        visit_date="2026-07-10",
        expected_rent=100000,
        rent_type="fixed",
        staggered_escalation=staggered_payload,
        area_sqft=1200,
    )
    
    site = session.added[0]
    
    assert site.rent_type == "fixed"
    assert site.staggered_escalation is None
    assert site.area_sqft == 1200
