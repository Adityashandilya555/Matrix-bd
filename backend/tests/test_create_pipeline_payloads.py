import pytest
from app.domain.schemas.site import CreateDraftRequest
from pydantic import ValidationError

def test_create_draft_request_revshare():
    req = CreateDraftRequest(
        name="Revshare Site",
        city="Mumbai",
        visit_date="2026-07-10",
        rent_type="revshare",
        expected_revshare_pct=15.5
    )
    assert req.rent_type == "revshare"
    assert req.expected_revshare_pct == 15.5

def test_create_draft_request_fixed():
    req = CreateDraftRequest(
        name="Fixed Site",
        city="Mumbai",
        visit_date="2026-07-10",
        rent_type="fixed",
        expected_rent=100000,
        expected_escalation_pct=5.0,
        expected_escalation_years=3
    )
    assert req.rent_type == "fixed"
    assert req.expected_rent == 100000
    assert req.expected_escalation_pct == 5.0
    assert req.expected_escalation_years == 3

def test_create_draft_request_mg_revshare():
    req = CreateDraftRequest(
        name="MG Revshare Site",
        city="Mumbai",
        visit_date="2026-07-10",
        rent_type="mg_revshare",
        expected_rent=80000,
        expected_revshare_pct=10.0,
        expected_escalation_pct=4.0,
        expected_escalation_years=1
    )
    assert req.rent_type == "mg_revshare"
    assert req.expected_rent == 80000
    assert req.expected_revshare_pct == 10.0

def test_create_draft_request_staggered():
    req = CreateDraftRequest(
        name="Staggered Site",
        city="Mumbai",
        visit_date="2026-07-10",
        rent_type="staggered",
        expected_rent=150000,
        staggered_escalation=[
            {"year": 1, "percent": 5.0},
            {"year": 2, "percent": 6.0}
        ]
    )
    assert req.rent_type == "staggered"
    assert len(req.staggered_escalation) == 2
    assert req.staggered_escalation[0].percent == 5.0

def test_create_draft_request_staggered_invalid():
    with pytest.raises(ValidationError) as exc_info:
        CreateDraftRequest(
            name="Staggered Invalid Site",
            city="Mumbai",
            visit_date="2026-07-10",
            rent_type="staggered",
            # Missing expected_rent and staggered_escalation
        )
    assert "expected_rent is required for staggered rent" in str(exc_info.value)
