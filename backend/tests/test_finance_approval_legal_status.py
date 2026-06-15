"""Regression: the admin finance-approval view must carry the upstream legal
status. It used to omit `legal_dd_status`, so the legal stage rendered a default
"pending" even for sites whose due diligence had cleared.
"""
from __future__ import annotations

import inspect


def test_finance_approval_schema_carries_legal_status():
    from app.domain.schemas.business_admin import FinanceApprovalOut

    fields = FinanceApprovalOut.model_fields
    assert "legal_dd_status" in fields
    assert "agreement_status" in fields
    assert "licensing_status" in fields


def test_list_finance_approvals_populates_legal_status():
    import app.services.business_admin_service as svc

    src = inspect.getsource(svc.list_finance_approvals)
    # The row dict must surface the real legal/agreement/licensing state.
    assert '"legal_dd_status": site.legal_dd_status' in src
    assert '"agreement_status": site.agreement_status' in src
    assert '"licensing_status": site.licensing_status' in src
