from app.domain.schemas.site import CreateDraftRequest
import datetime

try:
    CreateDraftRequest(
        name="TEST - 19",
        city="Agartala",
        visit_date=datetime.date(2026, 7, 11),
        model="BTC Cafe+",
        area_sqft=32,
        google_pin="28.6664912, 77.1185303",
        rent_type="revshare",
        expected_revshare_pct=31312,
    )
    print("SUCCESS (Expected Failure)")
except Exception as e:
    print("FAILED AS EXPECTED:", e)
