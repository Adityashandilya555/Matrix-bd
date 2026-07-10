from app.domain.schemas.site import SiteResponse
from app.db import models

site = models.Site(
    name="Test",
    city="Mumbai",
    tenant_id="00000000-0000-0000-0000-000000000002",
    status="draft_submitted",
    submitted_by="00000000-0000-0000-0000-000000000001",
)

try:
    SiteResponse.model_validate(site)
    print("SUCCESS")
except Exception as e:
    print("FAILED:", repr(e))
