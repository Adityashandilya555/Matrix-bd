"""Guards against the destructive empty / all-null budget save.

Root cause of the 'attachment upload wiped every value' bug: a save/submit that
arrived with empty items ran ``replace_budget_items`` (delete-then-reinsert),
nulling all 11 rows + area/covers. The frontend clobber is fixed separately;
these lock the backend so no future partial/retried/foreign client can wipe a
saved budget. Covers both the Project Excellence (gfc) and Financial Closure
(closure) save paths, which share ``replace_budget_items``.
"""
from __future__ import annotations

import inspect
import types
import uuid

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.domain.schemas.financial_closure import FCBudgetItemIn, SaveFCBudgetRequest
from app.domain.schemas.project_excellence import PEBudgetItemIn, SavePEBudgetRequest

TENANT = str(uuid.uuid4())


def _actor():
    return {"sub": str(uuid.uuid4()), "name": "Sup", "role": "supervisor"}


def _site():
    return types.SimpleNamespace(
        id=uuid.uuid4(), tenant_id=uuid.UUID(TENANT),
        design_status="approved",                 # _assert_pe_unlocked passes
        financial_closure_status="in_progress",   # _assert_closure_open passes
        project_excellence_status="budgeting",
    )


def _budget():
    return types.SimpleNamespace(
        id=uuid.uuid4(), tenant_id=uuid.UUID(TENANT), phase="gfc", status="draft",
        total_indoor_area_sqft=None, total_area_sqft=None, covers=None,
        budget_total=None, supervisor_comments=None,
    )


# ── Schema-level: an empty items array can't even be constructed ──────────────

def test_save_pe_request_rejects_empty_items():
    with pytest.raises(ValidationError):
        SavePEBudgetRequest(items=[])


def test_save_fc_request_rejects_empty_items():
    with pytest.raises(ValidationError):
        SaveFCBudgetRequest(items=[])


# ── PE service guards (defense in depth for direct/foreign callers) ───────────

def _patch_pe(monkeypatch, *, replaced):
    import app.services.project_excellence_service as pe

    async def _fetch(*a, **k):
        return _site()

    async def _canwork(*a, **k):
        return None

    async def _foc(*a, **k):
        return _budget()

    async def _replace(session, *, budget, amounts, labels):
        replaced.append({"amounts": amounts, "labels": labels})
        return 0.0

    async def _build(*a, **k):
        return "PE_RESP"

    async def _audit(*a, **k):
        return None

    monkeypatch.setattr(pe, "fetch_site_for_update_or_404", _fetch)
    monkeypatch.setattr(pe, "_assert_can_work_pe", _canwork)
    monkeypatch.setattr(pe.budget_service, "fetch_or_create_budget", _foc)
    monkeypatch.setattr(pe.budget_service, "replace_budget_items", _replace)
    monkeypatch.setattr(pe, "_build_response", _build)
    monkeypatch.setattr(pe, "write_audit_event", _audit)
    return pe


async def test_pe_empty_items_guard_refuses_wipe(make_session, monkeypatch):
    replaced: list = []
    pe = _patch_pe(monkeypatch, replaced=replaced)
    # model_construct bypasses the schema min_length=1 to exercise the service guard.
    body = SavePEBudgetRequest.model_construct(
        items=[], action="save",
        total_indoor_area_sqft=None, total_area_sqft=None, covers=None,
    )
    with pytest.raises(HTTPException) as exc:
        await pe.svc_save_pe_budget(make_session(), tenant_id=TENANT, actor=_actor(), site_id="s", body=body)
    assert exc.value.status_code == 422
    assert replaced == []  # replace_budget_items never ran → nothing wiped


async def test_pe_all_null_submit_rejected(make_session, monkeypatch):
    replaced: list = []
    pe = _patch_pe(monkeypatch, replaced=replaced)
    body = SavePEBudgetRequest(
        items=[PEBudgetItemIn(idx=i, label=f"L{i}", amount=None) for i in range(1, 12)],
        action="submit",
    )
    with pytest.raises(HTTPException) as exc:
        await pe.svc_save_pe_budget(make_session(), tenant_id=TENANT, actor=_actor(), site_id="s", body=body)
    assert exc.value.status_code == 422
    assert replaced == []


async def test_pe_all_null_save_draft_allowed(make_session, monkeypatch):
    replaced: list = []
    pe = _patch_pe(monkeypatch, replaced=replaced)
    body = SavePEBudgetRequest(
        items=[PEBudgetItemIn(idx=i, label=f"L{i}", amount=None) for i in range(1, 12)],
        action="save",
    )
    out = await pe.svc_save_pe_budget(make_session(), tenant_id=TENANT, actor=_actor(), site_id="s", body=body)
    assert out == "PE_RESP"          # no raise — a draft may be saved empty
    assert len(replaced) == 1        # and replace_budget_items did run


async def test_pe_real_amounts_submit_persists(make_session, monkeypatch):
    replaced: list = []
    pe = _patch_pe(monkeypatch, replaced=replaced)
    items = [PEBudgetItemIn(idx=i, label=f"L{i}", amount=(100 if i == 1 else None)) for i in range(1, 12)]
    out = await pe.svc_save_pe_budget(
        make_session(), tenant_id=TENANT, actor=_actor(), site_id="s",
        body=SavePEBudgetRequest(items=items, action="submit"),
    )
    assert out == "PE_RESP"
    assert replaced and replaced[0]["amounts"][1] == 100


# ── FC service guards (same shared destructive path) ──────────────────────────

def _patch_fc(monkeypatch, *, replaced):
    import app.services.financial_closure_service as fc

    async def _fetch(*a, **k):
        return _site()

    async def _canwork(*a, **k):
        return None

    async def _foc(*a, **k):
        return _budget()

    async def _replace(session, *, budget, amounts, labels):
        replaced.append({"amounts": amounts})
        return 0.0

    async def _build(*a, **k):
        return "FC_RESP"

    async def _audit(*a, **k):
        return None

    monkeypatch.setattr(fc, "fetch_site_for_update_or_404", _fetch)
    monkeypatch.setattr(fc, "_assert_can_work_fc", _canwork)
    monkeypatch.setattr(fc.budget_service, "fetch_or_create_budget", _foc)
    monkeypatch.setattr(fc.budget_service, "replace_budget_items", _replace)
    monkeypatch.setattr(fc, "_build_fc_state", _build)
    monkeypatch.setattr(fc, "write_audit_event", _audit)
    return fc


async def test_fc_empty_items_guard_refuses_wipe(make_session, monkeypatch):
    replaced: list = []
    fc = _patch_fc(monkeypatch, replaced=replaced)
    body = SaveFCBudgetRequest.model_construct(items=[], action="save", comments=None)
    with pytest.raises(HTTPException) as exc:
        await fc.svc_save_fc_budget(make_session(), tenant_id=TENANT, actor=_actor(), site_id="s", body=body)
    assert exc.value.status_code == 422
    assert replaced == []


async def test_fc_all_null_submit_rejected(make_session, monkeypatch):
    replaced: list = []
    fc = _patch_fc(monkeypatch, replaced=replaced)
    body = SaveFCBudgetRequest(
        items=[FCBudgetItemIn(idx=i, label=f"L{i}", amount=None) for i in range(1, 12)],
        action="submit",
    )
    with pytest.raises(HTTPException) as exc:
        await fc.svc_save_fc_budget(make_session(), tenant_id=TENANT, actor=_actor(), site_id="s", body=body)
    assert exc.value.status_code == 422
    assert replaced == []


# ── Send-back must never touch items (nothing to restore if it did) ───────────

def test_pe_admin_send_back_does_not_replace_items():
    import app.services.project_excellence_service as pe
    src = inspect.getsource(pe.svc_admin_review_pe_budget)
    assert "replace_budget_items" not in src
    assert "delete(" not in src


def test_pe_supervisor_send_back_does_not_replace_items():
    import app.services.project_excellence_service as pe
    src = inspect.getsource(pe.svc_review_pe_budget)
    assert "replace_budget_items" not in src
    assert "delete(" not in src
