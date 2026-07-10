import pytest
from unittest.mock import patch, AsyncMock
from app.main import _verify_schema

@pytest.fixture
def mock_engine_connect():
    with patch("app.main.engine") as mock_engine:
        mock_conn = AsyncMock()
        mock_engine.connect.return_value.__aenter__.return_value = mock_conn
        yield mock_conn

@pytest.mark.asyncio
async def test_verify_schema_success(mock_engine_connect):
    mock_engine_connect.execute.side_effect = [
        AsyncMock(fetchall=lambda: [('area_sqft',), ('google_maps_url',), ('expected_rent',), ('rent_type',), ('expected_escalation_pct',), ('expected_escalation_years',), ('expected_revshare_pct',), ('rent_set_at',)]),
        # 2. model data_type
        AsyncMock(fetchone=lambda: ('text',)),
        # 3. chk_sites_status
        AsyncMock(fetchone=lambda: ("CHECK (status IN ('draft_submitted', 'shortlisted', 'details_submitted', 'approved', 'loi_uploaded', 'legal_review', 'legal_approved', 'legal_rejected', 'pushed_to_payments', 'rejected', 'archived', 'launched'))",)),
        # 4. chk_site_details_rent_type
        AsyncMock(fetchone=lambda: ("CHECK (rent_type IN ('fixed', 'revshare', 'mg_revshare', 'staggered'))",))
    ]

    # Should pass without SystemExit
    await _verify_schema()

@pytest.mark.asyncio
async def test_verify_schema_missing_pushed_to_payments(mock_engine_connect):
    mock_engine_connect.execute.side_effect = [
        AsyncMock(fetchall=lambda: [('area_sqft',), ('google_maps_url',), ('expected_rent',), ('rent_type',), ('expected_escalation_pct',), ('expected_escalation_years',), ('expected_revshare_pct',), ('rent_set_at',)]),
        AsyncMock(fetchone=lambda: ('text',)),
        # Missing 'pushed_to_payments'
        AsyncMock(fetchone=lambda: ("CHECK (status IN ('draft_submitted', 'shortlisted', 'launched'))",)),
        AsyncMock(fetchone=lambda: ("CHECK (rent_type IN ('fixed', 'revshare', 'mg_revshare', 'staggered'))",))
    ]

    with pytest.raises(SystemExit):
        await _verify_schema()

@pytest.mark.asyncio
async def test_verify_schema_missing_staggered(mock_engine_connect):
    mock_engine_connect.execute.side_effect = [
        AsyncMock(fetchall=lambda: [('area_sqft',), ('google_maps_url',), ('expected_rent',), ('rent_type',), ('expected_escalation_pct',), ('expected_escalation_years',), ('expected_revshare_pct',), ('rent_set_at',)]),
        AsyncMock(fetchone=lambda: ('text',)),
        AsyncMock(fetchone=lambda: ("CHECK (status IN ('draft_submitted', 'shortlisted', 'details_submitted', 'approved', 'loi_uploaded', 'legal_review', 'legal_approved', 'legal_rejected', 'pushed_to_payments', 'rejected', 'archived', 'launched'))",)),
        # Missing 'staggered'
        AsyncMock(fetchone=lambda: ("CHECK (rent_type IN ('fixed', 'revshare', 'mg_revshare'))",))
    ]

    with pytest.raises(SystemExit):
        await _verify_schema()

@pytest.mark.asyncio
async def test_verify_schema_model_not_text(mock_engine_connect):
    mock_engine_connect.execute.side_effect = [
        AsyncMock(fetchall=lambda: [('area_sqft',), ('google_maps_url',), ('expected_rent',), ('rent_type',), ('expected_escalation_pct',), ('expected_escalation_years',), ('expected_revshare_pct',), ('rent_set_at',)]),
        # Model is enum
        AsyncMock(fetchone=lambda: ('USER-DEFINED',)),
        AsyncMock(fetchone=lambda: ("CHECK (status IN ('draft_submitted', 'shortlisted', 'details_submitted', 'approved', 'loi_uploaded', 'legal_review', 'legal_approved', 'legal_rejected', 'pushed_to_payments', 'rejected', 'archived', 'launched'))",)),
        AsyncMock(fetchone=lambda: ("CHECK (rent_type IN ('fixed', 'revshare', 'mg_revshare', 'staggered'))",))
    ]

    with pytest.raises(SystemExit):
        await _verify_schema()
