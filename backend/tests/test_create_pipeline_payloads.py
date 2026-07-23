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


# ── FEATURE_RENT_V2: revenue-share split + staggered superset (20260809) ──────

def test_create_draft_request_fixed_with_revshare_split():
    req = CreateDraftRequest(
        name="Split Site", city="Mumbai", visit_date="2026-07-23",
        rent_type="fixed", expected_rent=120000,
        expected_escalation_pct=5, expected_escalation_years=3,
        revshare_dinein_pct=8, revshare_delivery_pct=5,
    )
    assert req.revshare_dinein_pct == 8
    assert req.revshare_delivery_pct == 5


def test_create_draft_request_staggered_with_per_year_split():
    req = CreateDraftRequest(
        name="Staggered Split", city="Mumbai", visit_date="2026-07-23",
        rent_type="staggered", expected_rent=150000,
        staggered_escalation=[
            {"year": 1, "percent": 5.0, "dine_in_pct": 10, "delivery_pct": 4, "mg": 90000},
            {"year": 2, "percent": 6.0},  # legacy-shaped item stays valid
        ],
    )
    assert req.staggered_escalation[0].dine_in_pct == 10
    assert req.staggered_escalation[0].delivery_pct == 4
    assert req.staggered_escalation[0].mg == 90000
    # Missing optional keys default to None — the superset is backward-compatible.
    assert req.staggered_escalation[1].dine_in_pct is None


def test_staggered_item_percent_zero_now_allowed():
    # The DB CHECK has always allowed percent 0; Pydantic was gt=0 and wrongly
    # rejected it. It is now ge=0 to match.
    req = CreateDraftRequest(
        name="Zero Esc", city="Mumbai", visit_date="2026-07-23",
        rent_type="staggered", expected_rent=100000,
        staggered_escalation=[{"year": 1, "percent": 0}],
    )
    assert req.staggered_escalation[0].percent == 0


def test_staggered_item_rejects_out_of_range_split():
    with pytest.raises(ValidationError):
        CreateDraftRequest(
            name="Bad Split", city="Mumbai", visit_date="2026-07-23",
            rent_type="staggered", expected_rent=100000,
            staggered_escalation=[{"year": 1, "percent": 5, "delivery_pct": 150}],
        )


def test_save_details_request_accepts_camelcase_split():
    from app.domain.schemas.site import SaveDetailsRequest
    req = SaveDetailsRequest.model_validate({"revshareDineinPct": 12, "revshareDeliveryPct": 8})
    assert req.revshare_dinein_pct == 12
    assert req.revshare_delivery_pct == 8
    # Dumps back to snake_case so the service reads a single canonical key.
    assert req.model_dump()["revshare_dinein_pct"] == 12
