"""The two thin QA-report VIEW routes.

Added so a PE supervisor/delegate can view the uploaded before/after PDFs from
the push box, and the business-admin can see them on the Financial Closure
review card. Both delegate to the actor-agnostic ``svc_qa_reports_for_site``
behind their own guard — the original project route is project-module +
supervisor/executive gated, so neither PE-module users nor the admin pass it.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

TENANT = str(uuid.uuid4())
SITE = str(uuid.uuid4())


def _admin():
    return {"sub": str(uuid.uuid4()), "role": "business_admin", "name": "Admin"}


def _supervisor():
    return {"sub": str(uuid.uuid4()), "role": "supervisor", "name": "Sup"}


def _executive():
    return {"sub": str(uuid.uuid4()), "role": "executive", "name": "Exec"}


async def test_pe_qa_reports_route_delegates_to_service(session, monkeypatch):
    from app.routers import project_excellence as pe

    seen = {}

    async def _svc(_db, *, tenant_id, site_id):
        seen.update(tenant_id=tenant_id, site_id=site_id)
        return "QA_RESPONSE"

    monkeypatch.setattr(pe, "svc_qa_reports_for_site", _svc)
    out = await pe.qa_reports_for_site(
        site_id=SITE, db=session, current_user=_supervisor(), _module={}, tenant_id=TENANT,
    )
    assert out == "QA_RESPONSE"
    assert seen == {"tenant_id": TENANT, "site_id": SITE}


async def test_pe_qa_reports_404s_undelegated_executive(session, monkeypatch):
    """PR #445 review: an executive must NOT be able to read another site's
    report PDFs by guessing its id — scoped to their PE/QA delegations."""
    from app.routers import project_excellence as pe

    called = {"svc": False}

    async def _svc(_db, *, tenant_id, site_id):
        called["svc"] = True
        return "QA_RESPONSE"

    async def _not_delegated(_db, *, tenant_id, site_id, user_id, module):
        return False

    monkeypatch.setattr(pe, "svc_qa_reports_for_site", _svc)
    monkeypatch.setattr(pe, "svc_is_delegated", _not_delegated)
    with pytest.raises(HTTPException) as exc:
        await pe.qa_reports_for_site(
            site_id=SITE, db=session, current_user=_executive(), _module={}, tenant_id=TENANT,
        )
    assert exc.value.status_code == 404
    assert called["svc"] is False  # never signed URLs for a site they can't see


async def test_pe_qa_reports_allows_delegated_executive(session, monkeypatch):
    from app.routers import project_excellence as pe

    async def _svc(_db, *, tenant_id, site_id):
        return "QA_RESPONSE"

    async def _delegated(_db, *, tenant_id, site_id, user_id, module):
        return module == "quality_audit"

    monkeypatch.setattr(pe, "svc_qa_reports_for_site", _svc)
    monkeypatch.setattr(pe, "svc_is_delegated", _delegated)
    out = await pe.qa_reports_for_site(
        site_id=SITE, db=session, current_user=_executive(), _module={}, tenant_id=TENANT,
    )
    assert out == "QA_RESPONSE"


async def test_fc_admin_qa_reports_route_delegates_to_service(session, monkeypatch):
    from app.routers import financial_closure as fc

    seen = {}

    async def _svc(_db, *, tenant_id, site_id):
        seen.update(tenant_id=tenant_id, site_id=site_id)
        return "QA_RESPONSE"

    monkeypatch.setattr(fc, "svc_qa_reports_for_site", _svc)
    out = await fc.fc_admin_qa_reports(
        site_id=SITE, db=session, _auth=_admin(), tenant_id=TENANT,
    )
    assert out == "QA_RESPONSE"
    assert seen == {"tenant_id": TENANT, "site_id": SITE}


def test_qa_view_routes_are_registered_as_get():
    # Inspect the ROUTER objects, not app.main.app.routes — another test
    # (test_batch_sec_auth_config) mutates the assembled app's route list, which
    # made an app-level assertion order-dependent (green locally, red in CI).
    from app.routers import financial_closure as fc
    from app.routers import project_excellence as pe

    def _get_paths(router):
        return {r.path for r in router.routes if "GET" in getattr(r, "methods", set())}

    assert "/project-excellence/{site_id}/quality-audit/reports" in _get_paths(pe.router)
    assert "/financial-closure/admin-detail/{site_id}/qa-reports" in _get_paths(fc.router)


def test_pe_qa_route_is_project_excellence_module_gated():
    """The PE route must sit behind the project_excellence module guard (not the
    project-module one) — otherwise it would be unreachable for PE users."""
    import inspect
    from app.routers import project_excellence as pe

    src = inspect.getsource(pe.qa_reports_for_site)
    assert "InPEModule" in src and "PEMember" in src


def test_fc_admin_qa_route_is_business_admin_gated():
    import inspect
    from app.routers import financial_closure as fc

    src = inspect.getsource(fc.fc_admin_qa_reports)
    assert "BusinessAdmin" in src
