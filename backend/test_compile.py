import asyncio
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.schema import CreateTable
from app.db.models import Site
from datetime import datetime, timezone
import uuid

def test_compile():
    engine = create_engine("sqlite:///:memory:")
    print("CREATE TABLE SQL:")
    print(CreateTable(Site.__table__).compile(engine))
    Site.__table__.create(engine)
    
    # Let's try to insert to see if SQLAlchemy throws a compile error
    site = Site(
        tenant_id=uuid.uuid4(),
        code="BT-AGR-XYZW",
        status="draft_submitted",
        name="e",
        city="Agra",
        expected_rent=None,
        rent_type="revshare",
        expected_escalation_pct=None,
        expected_escalation_years=None,
        expected_revshare_pct=7.0,
        area_sqft=32,
        staggered_escalation=None,
        rent_set_at=datetime.now(timezone.utc),
        submitted_by=uuid.uuid4(),
    )
    Session = sessionmaker(bind=engine)
    session = Session()
    session.add(site)
    try:
        session.flush()
        print("Flush successful!")
    except Exception as e:
        print(f"Error during flush: {e}")

if __name__ == "__main__":
    test_compile()
