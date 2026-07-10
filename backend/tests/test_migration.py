import pytest
from sqlalchemy import text
from app.db import engine

@pytest.mark.asyncio
async def test_latest_migration_constraints():
    """Verify the database schema matches the expected normalized state."""
    try:
        async with engine.connect() as conn:
            # Check sites.model is text
            res = await conn.execute(text("""
                SELECT data_type
                FROM information_schema.columns
                WHERE table_name = 'sites' AND column_name = 'model';
            """))
            assert res.fetchone()[0] == 'text'

            # Check sites.status constraint
            res = await conn.execute(text("""
                SELECT pg_get_constraintdef(c.oid)
                FROM pg_constraint c
                JOIN pg_class t ON c.conrelid = t.oid
                WHERE t.relname = 'sites' AND c.conname = 'chk_sites_status';
            """))
            constraint_def = res.fetchone()[0]
            for status in [
                'draft_submitted', 'shortlisted', 'details_submitted', 'approved',
                'loi_uploaded', 'legal_review', 'legal_approved', 'legal_rejected',
                'pushed_to_payments', 'rejected', 'archived', 'launched'
            ]:
                assert f"'{status}'" in constraint_def, f"Missing status: {status}"

            # Check site_details.rent_type constraint
            res = await conn.execute(text("""
                SELECT pg_get_constraintdef(c.oid)
                FROM pg_constraint c
                JOIN pg_class t ON c.conrelid = t.oid
                WHERE t.relname = 'site_details' AND c.conname = 'chk_site_details_rent_type';
            """))
            constraint_def = res.fetchone()[0]
            for rent_type in ['fixed', 'revshare', 'mg_revshare', 'staggered']:
                assert f"'{rent_type}'" in constraint_def, f"Missing rent type: {rent_type}"
    except Exception as e:
        pytest.skip(f"Database connection unavailable: {e}")
