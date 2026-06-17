"""#230 — list / history / queue services must be bounded (LIMIT/OFFSET).

Every endpoint that backs a list/history/queue view loaded the entire
tenant-scoped result set with ``.all()`` / ``.scalars().all()`` and no bound, so
the payload grew monotonically with tenant lifetime (and per-row enrichment
multiplied the round trips). The fix mirrors the already-bounded
``svc_nso_queue``: ``limit``/``offset`` on the service, ``Query(50, le=200)`` /
``Query(0, ge=0)`` on the router, chained ``.limit().offset()`` onto the existing
ordered statement, and ``total = len(items)`` page semantics preserved.

These tests drive each service with an empty ``RecordingSession`` result and
assert the emitted SQL carries ``LIMIT`` and ``OFFSET``. They fail on the pre-fix
code (no bound) and pass after — a permanent guard against the class returning.
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
