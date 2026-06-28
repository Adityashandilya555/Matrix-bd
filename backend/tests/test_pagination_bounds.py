"""#230 — list / history / queue services must be bounded (LIMIT/OFFSET).

Every endpoint that backs a list/history/queue view loaded the entire
tenant-scoped result set with ``.all()`` / ``.scalars().all()`` and no bound, so
the payload grew monotonically with tenant lifetime (and per-row enrichment
multiplied the round trips). The fix bounds each query with a generous safety
ceiling (``limit`` default 500, hard max 1000) chained as ``.limit().offset()``
onto the existing ordered statement, and reports ``total`` as a real
``COUNT(*)`` of the filtered set (via ``_common.count_rows``) — NOT
``len(items)`` — so KPI tiles stay accurate even when a tenant exceeds the
ceiling. The 500 default keeps the existing fetch-everything UI working for
realistic tenants while a "load more" pager is built (tracked follow-up).

These tests drive each service with an empty ``RecordingSession`` result and
assert the emitted SQL carries ``LIMIT``, ``OFFSET`` and a ``COUNT``. They fail
on the pre-fix code (no bound, no count) and pass after — a permanent guard
against the class returning.
"""
from __future__ import annotations

from uuid import uuid4

import pytest

from app.services import (
    design_service,
    financial_closure_service,
    launch_service,
    legal_service,
    nso_service,
    project_excellence_service,
    project_service,
)

# (label, coroutine factory) — each returns the awaitable for one paginated svc.
# A few empty FakeResults are queued so any batched follow-up query is harmless.
_PAGINATED = [
    ("nso_history",
     lambda s, t, fr: nso_service.svc_nso_history(s, tenant_id=t, limit=25, offset=5)),
    ("project_queue",
     lambda s, t, fr: project_service.svc_project_queue(s, tenant_id=t, limit=25, offset=5)),
    ("project_history",
     lambda s, t, fr: project_service.svc_project_history(s, tenant_id=t, limit=25, offset=5)),
    ("pe_queue",
     lambda s, t, fr: project_excellence_service.svc_pe_queue(s, tenant_id=t, limit=25, offset=5)),
    ("fc_queue",
     lambda s, t, fr: financial_closure_service.svc_fc_queue(s, tenant_id=t, limit=25, offset=5)),
    ("fc_admin_queue",
     lambda s, t, fr: financial_closure_service.svc_fc_admin_queue(s, tenant_id=t, limit=25, offset=5)),
    ("legal_queue",
     lambda s, t, fr: legal_service.svc_legal_queue(s, tenant_id=t, limit=25, offset=5)),
    ("design_queue",
     lambda s, t, fr: design_service.svc_design_queue(s, tenant_id=t, limit=25, offset=5)),
    ("design_history",
     lambda s, t, fr: design_service.svc_design_history(s, tenant_id=t, limit=25, offset=5)),
    ("legal_history",
     lambda s, t, fr: legal_service.svc_legal_history(s, tenant_id=t, limit=25, offset=5)),
    ("launch_queue",
     lambda s, t, fr: launch_service.svc_get_launch_queue(s, tenant_id=t, limit=25, offset=5)),
]


@pytest.mark.asyncio
@pytest.mark.parametrize("label,call", _PAGINATED, ids=[p[0] for p in _PAGINATED])
async def test_list_query_is_bounded(label, call, make_session, fake_result):
    # Queue several empty results so the main query + any batched follow-ups
    # all resolve to an empty set without touching a DB.
    session = make_session(*[fake_result() for _ in range(6)])
    await call(session, uuid4(), fake_result)

    sql = session.sql.upper()
    assert "LIMIT" in sql, f"{label}: query is not bounded by LIMIT"
    assert "OFFSET" in sql, f"{label}: query has no OFFSET for paging"
    # total must be a real COUNT(*) of the filtered set, not len(items) — so KPI
    # tiles stay accurate past the safety ceiling (#230 follow-up requirement).
    assert "COUNT(" in sql, f"{label}: total is not a real COUNT(*) (KPIs would cap at the page)"


@pytest.mark.asyncio
async def test_count_rows_returns_real_count(make_session, fake_result):
    """count_rows yields the COUNT(*) scalar and strips ORDER BY from the subquery."""
    from sqlalchemy import select

    from app.db import models
    from app.services._common import count_rows

    session = make_session(fake_result(scalar=137))
    stmt = (
        select(models.Site)
        .where(models.Site.tenant_id == uuid4())
        .order_by(models.Site.updated_at)
    )
    assert await count_rows(session, stmt) == 137
    sql = session.sql.upper()
    assert "COUNT(" in sql
    assert "ORDER BY" not in sql, "count subquery must not carry ORDER BY"


@pytest.mark.asyncio
async def test_count_rows_handles_empty(make_session, fake_result):
    """A null scalar (e.g. no matching rows) resolves to 0, never None."""
    from sqlalchemy import select

    from app.db import models
    from app.services._common import count_rows

    session = make_session(fake_result(scalar=None))
    assert await count_rows(session, select(models.Site)) == 0
