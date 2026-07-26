"""Guards against APPROVING a budget that has no amounts.

The save-time guards (test_pe_budget_save_guards.py) stop an empty budget from
*entering* review. Nothing stopped one from *leaving* it: rows submitted before
those guards landed are still parked in ``pending_supervisor`` / ``pending_admin``
with all 11 amounts NULL. They render to the approver as ₹0 and eleven
em-dashes, and approving one is not cosmetic —

  * the gfc approval becomes the baseline every Financial Closure variation is
    computed against, and seeds the Project module's initialization date;
  * the closure approval is terminal (financial_closure_status='closed').

Send-back must stay open at every gate: returning the budget to the executive is
the only correct remedy for this state, so a guard that blocked it would strand
the site permanently.

Covers all four gates that can set an approved status.
"""
from __future__ import annotations

import types
import uuid

import pytest
from fastapi import HTTPException

from app.domain.schemas.financial_closure import FCAdminReviewRequest, FCReviewRequest
from app.domain.schemas.project_excellence import AdminBudgetReviewRequest, ReviewRequest

TENANT = str(uuid.uuid4())


def _admin():
    return {"sub": str(uuid.uuid4()), "name": "Admin", "role": "business_admin"}


def _supervisor():
    return {"sub": str(uuid.uuid4()), "name": "Sup", "role": "supervisor"}


def _site():
    return types.SimpleNamespace(
        id=uuid.uuid4(), tenant_id=uuid.UUID(TENANT),
        project_excellence_status="budgeting",
        financial_closure_status="in_progress",
    )


def _budget(status, phase="gfc"):
    return types.SimpleNamespace(
        id=uuid.uuid4(), tenant_id=uuid.UUID(TENANT), phase=phase, status=status,
        approved_at=None, supervisor_comments=None, admin_comments=None,
        budget_total=0.0,
    )


def _items(*amounts):
    """11 line rows carrying the given amounts (padded with NULLs)."""
    padded = list(amounts) + [None] * (11 - len(amounts))
    return [types.SimpleNamespace(idx=i + 1, amount=a) for i, a in enumerate(padded)]


def _patch(monkeypatch, module, *, budget, rows, build_name):
    """Stub every collaborator so only the guard under test is exercised."""
    async def _fetch(*a, **k):
        return _site()

    async def _foc(*a, **k):
        return budget

    async def _rows(*a, **k):
        return rows

    async def _build(*a, **k):
        return "RESP"

    async def _audit(*a, **k):
        return None

    async def _seed(*a, **k):
        return None

    monkeypatch.setattr(module, "fetch_site_for_update_or_404", _fetch)
    monkeypatch.setattr(module.budget_service, "fetch_or_create_budget", _foc)
    # assert_has_amounts is the real function; only its DB read is stubbed.
    monkeypatch.setattr(module.budget_service, "budget_items", _rows)
    monkeypatch.setattr(module, build_name, _build)
    monkeypatch.setattr(module, "write_audit_event", _audit)
    if hasattr(module, "project_service"):
        monkeypatch.setattr(module.project_service, "seed_initialization_from_pe", _seed)


# ── PE supervisor gate ───────────────────────────────────────────────────────

async def test_pe_supervisor_cannot_approve_empty_budget(make_session, monkeypatch):
    """An all-NULL budget must not be escalated to the admin."""
    import app.services.project_excellence_service as pe
    budget = _budget("pending_supervisor")
    _patch(monkeypatch, pe, budget=budget, rows=_items(), build_name="_build_response")
    with pytest.raises(HTTPException) as exc:
        await pe.svc_review_pe_budget(
            make_session(), tenant_id=TENANT, actor=_supervisor(), site_id="s",
            body=ReviewRequest(decision="approve"),
        )
    assert exc.value.status_code == 422
    assert "no amounts" in exc.value.detail
    assert budget.status == "pending_supervisor"  # unchanged


async def test_pe_supervisor_can_still_send_back_an_empty_budget(make_session, monkeypatch):
    """Send-back is the remedy — gating it would strand the site."""
    import app.services.project_excellence_service as pe
    budget = _budget("pending_supervisor")
    _patch(monkeypatch, pe, budget=budget, rows=_items(), build_name="_build_response")
    out = await pe.svc_review_pe_budget(
        make_session(), tenant_id=TENANT, actor=_supervisor(), site_id="s",
        body=ReviewRequest(decision="reject", comments="Amounts missing."),
    )
    assert out == "RESP"
    assert budget.status == "rejected"


async def test_pe_supervisor_approves_when_one_amount_is_present(make_session, monkeypatch):
    """A single real line is enough — the guard is not a total>0 test."""
    import app.services.project_excellence_service as pe
    budget = _budget("pending_supervisor")
    _patch(monkeypatch, pe, budget=budget, rows=_items(500), build_name="_build_response")
    out = await pe.svc_review_pe_budget(
        make_session(), tenant_id=TENANT, actor=_supervisor(), site_id="s",
        body=ReviewRequest(decision="approve"),
    )
    assert out == "RESP"
    assert budget.status == "pending_admin"


async def test_pe_approves_a_genuine_zero_line(make_session, monkeypatch):
    """0 is a legitimate amount and must not be mistaken for 'unfilled'."""
    import app.services.project_excellence_service as pe
    budget = _budget("pending_supervisor")
    _patch(monkeypatch, pe, budget=budget, rows=_items(0), build_name="_build_response")
    await pe.svc_review_pe_budget(
        make_session(), tenant_id=TENANT, actor=_supervisor(), site_id="s",
        body=ReviewRequest(decision="approve"),
    )
    assert budget.status == "pending_admin"


# ── PE admin gate ────────────────────────────────────────────────────────────

async def test_pe_admin_cannot_approve_empty_budget(make_session, monkeypatch):
    """The gfc baseline must never be approved empty — closure measures against it."""
    import app.services.project_excellence_service as pe
    budget = _budget("pending_admin")
    _patch(monkeypatch, pe, budget=budget, rows=_items(), build_name="_build_response")
    with pytest.raises(HTTPException) as exc:
        await pe.svc_admin_review_pe_budget(
            make_session(), tenant_id=TENANT, actor=_admin(), site_id="s",
            body=AdminBudgetReviewRequest(decision="approve", initialization_date="2026-08-01"),
        )
    assert exc.value.status_code == 422
    assert budget.status == "pending_admin"
    assert budget.approved_at is None


async def test_pe_admin_can_still_send_back_an_empty_budget(make_session, monkeypatch):
    """The admin's escape hatch for a legacy empty submission."""
    import app.services.project_excellence_service as pe
    budget = _budget("pending_admin")
    _patch(monkeypatch, pe, budget=budget, rows=_items(), build_name="_build_response")
    out = await pe.svc_admin_review_pe_budget(
        make_session(), tenant_id=TENANT, actor=_admin(), site_id="s",
        body=AdminBudgetReviewRequest(decision="reject"),
    )
    assert out == "RESP"
    assert budget.status == "rejected"


async def test_pe_admin_approves_a_filled_budget(make_session, monkeypatch):
    """The guard does not obstruct the normal path."""
    import app.services.project_excellence_service as pe
    budget = _budget("pending_admin")
    _patch(monkeypatch, pe, budget=budget, rows=_items(1200), build_name="_build_response")
    out = await pe.svc_admin_review_pe_budget(
        make_session(), tenant_id=TENANT, actor=_admin(), site_id="s",
        body=AdminBudgetReviewRequest(decision="approve", initialization_date="2026-08-01"),
    )
    assert out == "RESP"
    assert budget.status == "approved"


# ── FC supervisor gate ───────────────────────────────────────────────────────

async def test_fc_supervisor_cannot_approve_empty_closure(make_session, monkeypatch):
    """An empty closure must not reach the admin's terminal button."""
    import app.services.financial_closure_service as fc
    closure = _budget("pending_supervisor", phase="closure")
    _patch(monkeypatch, fc, budget=closure, rows=_items(), build_name="_build_fc_state")
    with pytest.raises(HTTPException) as exc:
        await fc.svc_review_fc_budget(
            make_session(), tenant_id=TENANT, actor=_supervisor(), site_id="s",
            body=FCReviewRequest(decision="approve"),
        )
    assert exc.value.status_code == 422
    assert "closure budget" in exc.value.detail
    assert closure.status == "pending_supervisor"


async def test_fc_supervisor_can_still_send_back(make_session, monkeypatch):
    """Send-back stays open at the closure supervisor gate too."""
    import app.services.financial_closure_service as fc
    closure = _budget("pending_supervisor", phase="closure")
    _patch(monkeypatch, fc, budget=closure, rows=_items(), build_name="_build_fc_state")
    out = await fc.svc_review_fc_budget(
        make_session(), tenant_id=TENANT, actor=_supervisor(), site_id="s",
        body=FCReviewRequest(decision="reject", comments="No actuals entered."),
    )
    assert out == "RESP"
    assert closure.status == "rejected"


# ── FC admin gate (terminal) ─────────────────────────────────────────────────

async def test_fc_admin_cannot_finalize_empty_closure(make_session, monkeypatch):
    """Finalizing archives the site — an empty closure would be unfixable after."""
    import app.services.financial_closure_service as fc
    closure = _budget("pending_admin", phase="closure")
    site_seen = {}

    async def _fetch(*a, **k):
        s = _site()
        site_seen["site"] = s
        return s

    _patch(monkeypatch, fc, budget=closure, rows=_items(), build_name="_build_fc_state")
    monkeypatch.setattr(fc, "fetch_site_for_update_or_404", _fetch)

    with pytest.raises(HTTPException) as exc:
        await fc.svc_admin_finalize_fc(
            make_session(), tenant_id=TENANT, actor=_admin(), site_id="s",
            body=FCAdminReviewRequest(decision="approve"),
        )
    assert exc.value.status_code == 422
    assert closure.status == "pending_admin"
    # The site must not have been archived on the way to the raise.
    assert site_seen["site"].financial_closure_status == "in_progress"


async def test_fc_admin_can_still_send_back(make_session, monkeypatch):
    """The only way to fix a legacy empty closure that reached the final gate."""
    import app.services.financial_closure_service as fc
    closure = _budget("pending_admin", phase="closure")
    _patch(monkeypatch, fc, budget=closure, rows=_items(), build_name="_build_fc_state")
    out = await fc.svc_admin_finalize_fc(
        make_session(), tenant_id=TENANT, actor=_admin(), site_id="s",
        body=FCAdminReviewRequest(decision="reject", comments="Re-enter actuals."),
    )
    assert out == "RESP"
    assert closure.status == "rejected"


async def test_fc_admin_finalizes_a_filled_closure(make_session, monkeypatch):
    """The normal terminal path still works."""
    import app.services.financial_closure_service as fc
    closure = _budget("pending_admin", phase="closure")
    _patch(monkeypatch, fc, budget=closure, rows=_items(999), build_name="_build_fc_state")
    out = await fc.svc_admin_finalize_fc(
        make_session(), tenant_id=TENANT, actor=_admin(), site_id="s",
        body=FCAdminReviewRequest(decision="approve"),
    )
    assert out == "RESP"
    assert closure.status == "approved"


# ── The shared helper itself ─────────────────────────────────────────────────

async def test_assert_has_amounts_rejects_a_budget_with_no_rows(make_session, monkeypatch):
    """No rows at all is as unreviewable as all-NULL rows."""
    from app.services import budget_service

    async def _none(*a, **k):
        return []

    monkeypatch.setattr(budget_service, "budget_items", _none)
    with pytest.raises(HTTPException) as exc:
        await budget_service.assert_has_amounts(make_session(), budget=_budget("pending_admin"))
    assert exc.value.status_code == 422
