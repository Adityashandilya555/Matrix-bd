"""Batch PERF — 2026-06-11 load-readiness sweep (#78, #81, #91, #94, #95, #133).

Every test is written to FAIL on the pre-fix code and PASS after:

  #78  bcrypt runs on a worker thread (off the event loop), not inline.
  #81  project budget-admin / NSO queues batch the delegate+name lookups (no N+1).
  #91  legal / design / bd_status / business_admin / project-history list
       endpoints batch their per-row child + name lookups (no N+1).
  #94  storage_service reuses one httpx client; the documents route signs URLs
       concurrently (gather), not one sequential round trip per file.
  #95  list endpoints emit a LIMIT (bounded) instead of an unbounded scan.
  #133 the Approval ORM model declares no duplicate indexes (the live out-of-band
       duplicates are dropped by migration 202606131).
"""
from __future__ import annotations

import asyncio
import threading
from datetime import datetime, timezone
from types import SimpleNamespace


from app.core import passwords


_DT = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _fake_site(i: int) -> SimpleNamespace:
    """A site with every attribute the various list serialisers read."""
    return SimpleNamespace(
        id=f"s{i}",
        code=f"C{i}",
        ca_code=None,
        name=f"Site {i}",
        city="City",
        submitted_by=f"u{i}",
        assigned_to=None,
        status="legal_rejected",
        design_status="pending",
        project_status="pending",
        legal_dd_status="negative",
        agreement_status="pending",
        licensing_status="pending",
        rejection_reason=None,
        legal_review_at=None,
        legal_approved_at=None,
        legal_rejected_at=_DT,
        updated_at=_DT,
        created_at=_DT,
        finance_amount=None,
        finance_status="awaiting_admin",
        kyc_verified=False,
    )


# ── #78 — bcrypt is offloaded to a worker thread ───────────────────────────

async def test_hash_password_async_runs_off_the_event_loop_thread(monkeypatch):
    main_thread = threading.get_ident()
    seen: dict = {}

    def spy_hashpw(*a, **k):
        seen["thread"] = threading.get_ident()
        return b"$2b$12$fakehashfakehashfakehashfakehashfakehashfa"

    monkeypatch.setattr(passwords.bcrypt, "hashpw", spy_hashpw)
    monkeypatch.setattr(passwords.bcrypt, "gensalt", lambda *a, **k: b"salt")

    out = await passwords.hash_password_async("hunter2")
    assert isinstance(out, str)
    # If bcrypt ran inline on the loop it would record the main thread id.
    assert seen["thread"] != main_thread


async def test_verify_password_async_runs_off_the_event_loop_thread(monkeypatch):
    main_thread = threading.get_ident()
    seen: dict = {}

    def spy_checkpw(*a, **k):
        seen["thread"] = threading.get_ident()
        return True

    monkeypatch.setattr(passwords.bcrypt, "checkpw", spy_checkpw)

    assert await passwords.verify_password_async("hunter2", "$2b$12$x") is True
    assert seen["thread"] != main_thread


# ── #81 — project budget-admin + NSO queues are not N+1 ────────────────────

async def test_budget_admin_queue_batches_lookups(make_session, fake_result):
    # The budget admin queue moved from Project → Project Excellence (#206); the
    # no-N+1 batching contract still holds in its new home.
    from app.services import project_excellence_service

    rows = [(_fake_site(i), None) for i in range(3)]
    sess = make_session(
        fake_result(scalar=3),           # count_rows total (queue is now paginated)
        fake_result(all_rows=rows),      # outer sites+budgets page
        fake_result(all_rows=[]),        # batched delegates
        fake_result(all_rows=[]),        # batched names
    )
    out = await project_excellence_service.svc_pe_budget_admin_queue(sess, tenant_id="t1")
    assert out.total == 3
    # 1 count + 1 outer + 1 delegate-batch + 1 name-batch = 4, regardless of N (was 1+2N).
    assert len(sess.executed) == 4


async def test_project_nso_queue_batches_lookups(make_session, fake_result):
    from app.services import project_service

    rows = [(_fake_site(i), None) for i in range(3)]
    sess = make_session(
        fake_result(all_rows=rows),
        fake_result(all_rows=[]),
        fake_result(all_rows=[]),
    )
    out = await project_service.svc_nso_queue(sess, tenant_id="t1")
    assert out.total == 3
    assert len(sess.executed) == 3


# ── #91 — the six per-row loops are batched ────────────────────────────────

async def test_project_history_batches_names(make_session, fake_result):
    from app.services import project_service

    rows = [(_fake_site(i), None) for i in range(4)]
    sess = make_session(
        fake_result(scalar=4),           # COUNT(*) — accurate total
        fake_result(all_rows=rows),      # outer
        fake_result(all_rows=[]),        # batched names
    )
    out = await project_service.svc_project_history(sess, tenant_id="t1")
    assert out.total == 4                # real COUNT(*), not len(items)
    assert len(sess.executed) == 3       # count + outer + batched names (was 1 + N)


async def test_legal_rejected_sites_batches_lookups(make_session, fake_result):
    from app.services import legal_service

    sites = [_fake_site(i) for i in range(3)]
    sess = make_session(
        fake_result(scalars_list=sites),  # outer
        fake_result(scalars_list=[]),     # batched DD
        fake_result(all_rows=[]),         # batched names
    )
    out = await legal_service.svc_legal_rejected_sites(sess, tenant_id="t1")
    assert out.total == 3
    assert len(sess.executed) == 3        # was 1 + 2N


async def test_legal_history_batches_lookups(make_session, fake_result):
    from app.services import legal_service

    sites = [_fake_site(i) for i in range(3)]
    sess = make_session(
        fake_result(scalar=3),            # COUNT(*) — accurate total
        fake_result(scalars_list=sites),
        fake_result(scalars_list=[]),
        fake_result(all_rows=[]),
    )
    out = await legal_service.svc_legal_history(sess, tenant_id="t1")
    assert out.total == 3                 # real COUNT(*), not len(items)
    assert len(sess.executed) == 4        # count + outer + batched DD + names


async def test_bd_dd_failed_queue_batches_lookups(make_session, fake_result):
    from app.services import bd_status_service

    sites = [_fake_site(i) for i in range(3)]
    sess = make_session(
        fake_result(scalars_list=sites),
        fake_result(scalars_list=[]),
        fake_result(all_rows=[]),
    )
    out = await bd_status_service.svc_bd_dd_failed_queue(sess, tenant_id="t1")
    assert out.total == 3
    assert len(sess.executed) == 3


async def test_design_gfc_queue_batches_lookups(make_session, fake_result):
    from app.services import design_service

    sites = [_fake_site(i) for i in range(3)]
    sess = make_session(
        fake_result(scalars_list=sites),
        fake_result(scalars_list=[]),     # batched BOQ deliverables
        fake_result(all_rows=[]),         # batched names
    )
    out = await design_service.svc_design_gfc_queue(sess, tenant_id="t1")
    assert out.total == 3
    assert len(sess.executed) == 3


async def test_finance_approvals_batches_names(make_session, fake_result):
    from app.services import business_admin_service

    sites = [_fake_site(i) for i in range(4)]
    sess = make_session(
        fake_result(scalars_list=sites),  # outer
        fake_result(all_rows=[]),         # batched names
    )
    items = await business_admin_service.list_finance_approvals(sess, tenant_id="t1")
    assert len(items) == 4
    assert len(sess.executed) == 2        # was 1 + N


# ── #94 — shared storage client + concurrent signing ───────────────────────

async def test_storage_client_is_shared():
    from app.services import storage_service

    c1 = storage_service.get_storage_client()
    c2 = storage_service.get_storage_client()
    assert c1 is c2
    await storage_service.aclose_storage_client()
    assert storage_service._holder.client is None


async def test_site_documents_signs_urls_concurrently(make_session, fake_result, monkeypatch):
    from app.routers import sites
    from app.services import storage_service

    site = _fake_site(1)
    files = [
        SimpleNamespace(
            id=f"f{i}", file_name=f"f{i}.pdf", file_type="loi", file_size_kb=1,
            mime_type="application/pdf", uploaded_at=_DT, uploaded_by="u1",
            storage_path=f"p{i}",
        )
        for i in range(4)
    ]
    sess = make_session(
        fake_result(scalar=site),          # fetch_site_or_404
        fake_result(scalars_list=files),   # SiteFile list
    )

    state = {"cur": 0, "max": 0}

    async def fake_signed_url(path, **k):
        state["cur"] += 1
        state["max"] = max(state["max"], state["cur"])
        await asyncio.sleep(0.01)
        state["cur"] -= 1
        return f"https://signed/{path}"

    monkeypatch.setattr(storage_service, "signed_url", fake_signed_url)

    out = await sites.get_site_documents(
        site_id="s1", db=sess, current_user={"role": "supervisor"}, tenant_id="t1", limit=100,
    )
    assert len(out["documents"]) == 4
    # Sequential signing would never exceed 1 in flight; gather runs them together.
    assert state["max"] >= 2


# ── #95 — list endpoints are bounded (emit LIMIT) ──────────────────────────

async def test_list_users_is_bounded(make_session, fake_result):
    from app.routers import users

    sess = make_session(fake_result(scalars_list=[]))
    await users.list_users(db=sess, _auth={"role": "supervisor"}, tenant_id="t1", limit=50, offset=0)
    assert "LIMIT" in sess.sql.upper()


async def test_list_pending_users_is_bounded(make_session, fake_result):
    from app.routers import users

    sess = make_session(fake_result(scalars_list=[]))
    await users.list_pending_users(db=sess, _auth={"role": "supervisor"}, tenant_id="t1", limit=50, offset=0)
    assert "LIMIT" in sess.sql.upper()


async def test_pending_change_requests_is_bounded(make_session, fake_result):
    from app.services import change_request_service

    sess = make_session(fake_result(scalars_list=[]))
    await change_request_service._list_with_status(sess, tenant_id="t1", status_filter="pending")
    assert "LIMIT" in sess.sql.upper()


async def test_nso_queue_is_bounded(make_session, fake_result):
    from app.services import nso_service

    sess = make_session(fake_result(scalars_list=[]))
    await nso_service.svc_nso_queue(sess, tenant_id="t1")
    assert "LIMIT" in sess.sql.upper()


async def test_list_cities_is_bounded(make_session, fake_result):
    from app.routers import tenancy

    sess = make_session(fake_result(all_rows=[]))
    await tenancy.list_cities(db=sess, _auth={"role": "supervisor"}, tenant_id="t1", limit=200)
    assert "LIMIT" in sess.sql.upper()


# ── Sweep siblings (found by the Phase-4 subagent, same classes) ───────────

async def test_design_history_batches_names(make_session, fake_result):
    # #91 sibling of svc_design_gfc_queue, missed by the issue's list.
    from app.services import design_service

    rows = [(_fake_site(i), None) for i in range(4)]
    sess = make_session(
        fake_result(scalar=4),           # COUNT(*) — accurate total
        fake_result(all_rows=rows),      # outer
        fake_result(all_rows=[]),        # batched names
    )
    out = await design_service.svc_design_history(sess, tenant_id="t1")
    assert out.total == 4                # real COUNT(*), not len(items)
    assert len(sess.executed) == 3       # count + outer + batched names (was 1 + N)


async def test_design_admin_queue_signs_urls_concurrently(make_session, fake_result, monkeypatch):
    # #94 sibling: download URLs were signed one sequential round trip per row.
    from app.services import design_service

    delivs = [
        SimpleNamespace(
            id=f"d{i}", site_id=f"s{i % 2}", kind="2d", status="approved",
            file_name=f"d{i}.pdf", file_url="design/obj", submitted_at=_DT,
            estimated_amount=None, supervisor_comments=None, reviewed_at=_DT,
            admin_status="pending",
        )
        for i in range(4)
    ]
    rows = [(d, "C", "CA-C", "Name", "City") for d in delivs]
    sess = make_session(fake_result(all_rows=rows))

    state = {"cur": 0, "max": 0}

    async def fake_sign(path, **k):
        state["cur"] += 1
        state["max"] = max(state["max"], state["cur"])
        await asyncio.sleep(0.01)
        state["cur"] -= 1
        return f"https://signed/{path}"

    monkeypatch.setattr(design_service, "storage_signed_url", fake_sign)
    out = await design_service.svc_design_admin_queue(sess, tenant_id="t1")
    assert out.total == 2                 # 4 deliverables grouped into 2 sites
    assert state["max"] >= 2              # signed concurrently (was 1 sequential)
    assert all(s.site_code == "CA-C" for s in out.items)  # ca_code preferred over placeholder code


# ── #133 — the Approval model has no duplicate indexes ─────────────────────

def test_approvals_model_has_no_duplicate_indexes():
    from sqlalchemy import Index

    from app.db import models

    col_sets = []
    for arg in models.Approval.__table_args__:
        if isinstance(arg, Index):
            col_sets.append(tuple(c.name for c in arg.columns))
    assert len(col_sets) == len(set(col_sets)), f"duplicate index column sets: {col_sets}"
