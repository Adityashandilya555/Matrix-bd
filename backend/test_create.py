import asyncio
import uuid
from datetime import datetime
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import text
from app.core.config import settings
from app.db.models import Site
from app.db.base import Base

async def test():
    engine = create_async_engine(str(settings.database_url), echo=True)
    # Create tables for in-memory SQLite
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        # Insert dummy tenant and user
        tenant_id = str(uuid.uuid4())
        await session.execute(text(
            "INSERT INTO tenants (id, slug, name, plan, seat_limit, workspace_code, created_at) "
            "VALUES (:id, 'test-slug', 'Test Tenant', 'standard', 10, 'TEST', :now)"
        ), {"id": tenant_id, "now": datetime.utcnow()})
        user_id = str(uuid.uuid4())
        await session.execute(text(
            "INSERT INTO users (id, tenant_id, role, email, name, is_active, created_at, updated_at) "
            "VALUES (:uid, :tid, 'executive', 'test@example.com', 'Test User', true, :now, :now)"
        ), {"uid": user_id, "tid": tenant_id, "now": datetime.utcnow()})
        await session.commit()

        # Retrieve ids
        tenant_id = (await session.execute(text("SELECT id FROM tenants LIMIT 1"))).scalar()
        user_id = (await session.execute(text("SELECT id FROM users LIMIT 1"))).scalar()

        if not tenant_id or not user_id:
            print("NO TENANT OR USER")
            return

        site = Site(
            tenant_id=tenant_id,
            code="BT-AGA-1234",
            status="draft_submitted",
            name="TEST - 19",
            city="Agartala",
            visit_date=datetime(2026, 7, 11),
            model="BTC Cafe+",
            area_sqft=32,
            google_maps_pin="28.6664912, 77.1185303",
            rent_type="revshare",
            expected_revshare_pct=3,
            submitted_by=user_id,
        )
        session.add(site)
        try:
            await session.flush()
            print("SUCCESS FLUSH")
        except Exception as e:
            print("FAILED FLUSH:", repr(e))

asyncio.run(test())
