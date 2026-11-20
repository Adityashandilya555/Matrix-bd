"""A vendor token reaches only /vendor/* and the auth routes.

The default-deny lives in get_current_user (app/core/deps.py), the one
dependency every authenticated route passes through, and the vendor portal's
own routes use require_real_role so business admins and observers (who bypass
require_role) cannot drive a vendor's portal.
"""
from __future__ import annotations

import inspect
import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core import deps
from app.core.security import AuthError
from app.rbac.roles import READ_ALL_ROLES, Role


def _req(path: str, method: str = "GET"):
    return SimpleNamespace(url=SimpleNamespace(path=path), method=method)


def _vendor_claims(**over):
    c = {"sub": str(uuid.uuid4()), "tenant_id": str(uuid.uuid4()), "role": "vendor", "real_role": "vendor"}
    c.update(over)
    return c


@pytest.mark.parametrize("path", ["/api/vendor/home", "/api/vendor/projects/x/updates/today", "/api/auth/whoami", "/vendor/me", "/auth/refresh"])
def test_vendor_allowed_paths(path):
    deps._assert_vendor_scope(_vendor_claims(), _req(path))


@pytest.mark.parametrize("path", [
    "/api/sites", "/api/vendor-admin/settings", "/api/vendor", "/api/business-admin/org", "/api/users/me",
    "/api/notifications", "/api/project/queue", "/api/tenancy/workspace-info", "/api/vendorx/home",
])
def test_vendor_refused_everywhere_else(path):
    with pytest.raises(HTTPException) as e:
        deps._assert_vendor_scope(_vendor_claims(), _req(path))
    assert e.value.status_code == 403


def test_scope_keys_on_real_role_not_role():
    # An override can never lift it, and a Matrix user is never affected.
    with pytest.raises(HTTPException):
        deps._assert_vendor_scope(_vendor_claims(role="supervisor"), _req("/api/sites"))
    deps._assert_vendor_scope({"role": "supervisor", "real_role": "supervisor"}, _req("/api/sites"))


def test_unlinked_or_suspended_vendor_is_signed_out():
    with pytest.raises(AuthError):
        deps._assert_vendor_scope(_vendor_claims(**{deps._VENDOR_REFUSED: True}), _req("/api/vendor/home"))


async def test_link_is_read_from_the_db_and_non_vendors_cost_no_query(make_session, fake_result):
    db = make_session()
    claims = {"sub": "u", "tenant_id": "t", "vendor_id": "forged"}
    await deps._load_vendor_link(db, claims, "supervisor")
    assert db.executed == [] and claims["vendor_id"] is None

    vid = str(uuid.uuid4())
    db = make_session(fake_result(mappings_rows=[{"vendor_id": vid, "vendor_role": "owner", "status": "active"}]))
    claims = _vendor_claims(vendor_id="forged-in-token")
    await deps._load_vendor_link(db, claims, "vendor")
    assert claims["vendor_id"] == vid and claims["vendor_role"] == "owner"

    db = make_session(fake_result(mappings_rows=[{"vendor_id": vid, "vendor_role": "owner", "status": "suspended"}]))
    claims = _vendor_claims()
    await deps._load_vendor_link(db, claims, "vendor")
    assert claims["vendor_id"] is None and claims[deps._VENDOR_REFUSED] is True


def test_override_headers_never_change_a_vendor():
    claims = {"role": "vendor", "real_role": "vendor"}
    deps._apply_workspace_override(
        claims, db_role="vendor", has_executive_access=False, has_module_grant=True, has_exec_module_grant=True,
        home_module=None, override_role="business_admin", override_module="bd",
    )
    assert claims["role"] == "vendor" and "module" not in claims


def test_scope_check_runs_after_the_rollback():
    """#103: raising before db.rollback() leaves the read transaction open."""
    src = inspect.getsource(deps.get_current_user)
    assert src.index("await db.rollback()") < src.index("_assert_vendor_scope(")
    assert src.index("_load_vendor_link(") < src.index("await db.rollback()")


def test_vendor_is_not_a_read_all_role():
    assert Role.VENDOR.value not in READ_ALL_ROLES


def test_every_vendor_portal_route_requires_the_real_vendor_role():
    from app.routers import vendor_portal

    def names(dependant):
        for d in dependant.dependencies:
            yield getattr(d.call, "__qualname__", "")
            yield from names(d)

    for route in vendor_portal.router.routes:
        assert any(n.startswith("require_real_role") for n in names(route.dependant)), route.path

