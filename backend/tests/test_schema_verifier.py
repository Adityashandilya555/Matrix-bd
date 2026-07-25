import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from app.main import _verify_schema

@pytest.fixture
def mock_engine_connect():
    with patch("app.main.engine") as mock_engine:
        mock_conn = AsyncMock()
        mock_engine.connect.return_value.__aenter__.return_value = mock_conn
        yield mock_conn

def _make_result(rows, is_fetchall=False):
    """Create a mock result object with sync fetchall/fetchone methods."""
    result = MagicMock()
    if is_fetchall:
        result.fetchall.return_value = rows
    else:
        result.fetchone.return_value = rows
    return result

@pytest.mark.asyncio
async def test_verify_schema_success(mock_engine_connect):
    mock_engine_connect.execute.side_effect = [
        # 1. columns check (fetchall)
        _make_result([
            ('area_sqft',), ('staggered_escalation',), ('google_maps_url',),
            ('expected_rent',), ('rent_type',), ('expected_escalation_pct',),
            ('expected_escalation_years',), ('expected_revshare_pct',), ('rent_set_at',),
            ('revshare_dinein_pct',), ('revshare_delivery_pct',),
        ], is_fetchall=True),
        # 2. model data_type (fetchone)
        _make_result(('text',)),
        # 3. all CHECK constraints on sites (fetchall)
        _make_result([
            ("CHECK (status IN ('draft_submitted', 'shortlisted', 'details_submitted', 'approved', 'loi_uploaded', 'legal_review', 'legal_approved', 'legal_rejected', 'pushed_to_payments', 'rejected', 'archived', 'launched'))",),
            ("CHECK (rent_type IN ('fixed', 'revshare', 'mg_revshare', 'staggered'))",),
        ], is_fetchall=True),
    ]

    # Should pass without SystemExit
    await _verify_schema()

@pytest.mark.asyncio
async def test_verify_schema_missing_staggered(mock_engine_connect):
    mock_engine_connect.execute.side_effect = [
        _make_result([
            ('area_sqft',), ('staggered_escalation',), ('google_maps_url',),
            ('expected_rent',), ('rent_type',), ('expected_escalation_pct',),
            ('expected_escalation_years',), ('expected_revshare_pct',), ('rent_set_at',),
            ('revshare_dinein_pct',), ('revshare_delivery_pct',),
        ], is_fetchall=True),
        _make_result(('text',)),
        # No constraint includes 'staggered'
        _make_result([
            ("CHECK (status IN ('draft_submitted', 'shortlisted'))",),
            ("CHECK (rent_type IN ('fixed', 'revshare', 'mg_revshare'))",),
        ], is_fetchall=True),
    ]

    with pytest.raises(SystemExit):
        await _verify_schema()

@pytest.mark.asyncio
async def test_verify_schema_model_not_text(mock_engine_connect):
    mock_engine_connect.execute.side_effect = [
        _make_result([
            ('area_sqft',), ('staggered_escalation',), ('google_maps_url',),
            ('expected_rent',), ('rent_type',), ('expected_escalation_pct',),
            ('expected_escalation_years',), ('expected_revshare_pct',), ('rent_set_at',),
            ('revshare_dinein_pct',), ('revshare_delivery_pct',),
        ], is_fetchall=True),
        # Model is enum
        _make_result(('USER-DEFINED',)),
        _make_result([
            ("CHECK (rent_type IN ('fixed', 'revshare', 'mg_revshare', 'staggered'))",),
        ], is_fetchall=True),
    ]

    with pytest.raises(SystemExit):
        await _verify_schema()

@pytest.mark.asyncio
async def test_verify_schema_missing_columns(mock_engine_connect):
    # Missing staggered_escalation column
    mock_engine_connect.execute.side_effect = [
        _make_result([
            ('area_sqft',), ('google_maps_url',),
            ('expected_rent',), ('rent_type',), ('expected_escalation_pct',),
            ('expected_escalation_years',), ('expected_revshare_pct',), ('rent_set_at',),
            ('revshare_dinein_pct',), ('revshare_delivery_pct',),
        ], is_fetchall=True),
    ]

    with pytest.raises(SystemExit):
        await _verify_schema()
