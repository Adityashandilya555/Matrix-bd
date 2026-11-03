"""Who admits new vendor people, and vendor data isolation.

Admission is a workspace setting: owners approve their own staff
(owner_approves_staff) or the business admin approves everyone
(admin_approves_all). Owners are always admitted by the business admin.
"""
from __future__ import annotations

import inspect
import uuid
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.routers import users
from app.services import vendor_project_service, vendor_service

TENANT = str(uuid.uuid4())
VENDOR = str(uuid.uuid4())
OTHER_VENDOR = str(uuid.uuid4())
PENDING = str(uuid.uuid4())
ADMIN = {"sub": str(uuid.uuid4()), "name": "Admin"}
OWNER = {"sub": str(uuid.uuid4()), "name": "Owner"}


def test_approver_rule():
    assert vendor_service.approver_for("owner_approves_staff", "site_supervisor") == "owner"
    assert vendor_service.approver_for("admin_approves_all", "site_supervisor") == "admin"
    assert vendor_service.approver_for("owner_approves_staff", "owner") == "admin"


def _settings_row(mode):
    from datetime import time
    return {"admission_mode": mode, "allow_self_signup": False, "update_cutoff_local": time(19, 0), "timezone": "Asia/Kolkata",
            "mall_duration_days": 40, "non_mall_duration_days": 45, "portal_title": None, "accent_color": None,
            "welcome_text": None, "support_contact": None, "logo_path": None}


def _pending(vendor_id=VENDOR, role="site_supervisor"):
    return {"id": PENDING, "email": "new@shreeji.example", "vendor_id": vendor_id, "vendor_role": role}


async def test_owner_approves_own_staff_in_owner_mode(make_session, fake_result):
    db = make_session(fake_result(mappings_rows=[_settings_row("owner_approves_staff")]), fake_result(mappings_rows=[_pending()]))
    out = await vendor_service.decide_pending(db, tenant_id=TENANT, actor=OWNER, user_id=PENDING, approve=True, as_owner_of=VENDOR)
    assert out == {"ok": True}
    assert any("SET is_active = true" in s for s in db.executed)


async def test_owner_cannot_decide_in_admin_mode_or_for_another_vendor(make_session, fake_result):
    db = make_session(fake_result(mappings_rows=[_settings_row("admin_approves_all")]), fake_result(mappings_rows=[_pending()]))
    with pytest.raises(HTTPException) as e:
        await vendor_service.decide_pending(db, tenant_id=TENANT, actor=OWNER, user_id=PENDING, approve=True, as_owner_of=VENDOR)
    assert e.value.status_code == 403
    db = make_session(fake_result(mappings_rows=[_settings_row("owner_approves_staff")]), fake_result(mappings_rows=[_pending(OTHER_VENDOR)]))
    with pytest.raises(HTTPException) as e:
        await vendor_service.decide_pending(db, tenant_id=TENANT, actor=OWNER, user_id=PENDING, approve=True, as_owner_of=VENDOR)
    assert e.value.status_code == 404      # another vendor's request is not confirmed to exist


async def test_admin_decides_owners_and_admin_mode_only(make_session, fake_result):
    db = make_session(fake_result(mappings_rows=[_settings_row("owner_approves_staff")]), fake_result(mappings_rows=[_pending()]))
    with pytest.raises(HTTPException) as e:
        await vendor_service.decide_pending(db, tenant_id=TENANT, actor=ADMIN, user_id=PENDING, approve=True)
    assert e.value.status_code == 403
    db = make_session(fake_result(mappings_rows=[_settings_row("owner_approves_staff")]), fake_result(mappings_rows=[_pending(role="owner")]))
    assert (await vendor_service.decide_pending(db, tenant_id=TENANT, actor=ADMIN, user_id=PENDING, approve=False)) == {"ok": True}
    assert any("DELETE FROM users" in s and "is_active = false" in s for s in db.executed)


async def test_malformed_ids_are_404_not_500(make_session):
    with pytest.raises(HTTPException) as e:
        await vendor_service.decide_pending(make_session(), tenant_id=TENANT, actor=ADMIN, user_id="not-a-uuid", approve=True)
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        await vendor_service.fetch_vendor(make_session(), TENANT, "nope")
    assert e.value.status_code == 404


async def test_settings_validation(make_session):
    base = {"admission_mode": "owner_approves_staff", "update_cutoff_local": "19:00", "mall_duration_days": 40, "non_mall_duration_days": 45}
    for bad, msg in [({"admission_mode": "anyone"}, "who approves"), ({"accent_color": "blue"}, "hex"),
                     ({"update_cutoff_local": "7pm"}, "time"), ({"mall_duration_days": 2}, "between 5 and 365")]:
        with pytest.raises(HTTPException) as e:
            await vendor_service.update_settings(make_session(), tenant_id=TENANT, actor=ADMIN, body={**base, **bad})
        assert e.value.status_code == 422 and msg in e.value.detail


def test_new_codes_have_full_entropy():
    from app.services.tenancy_service import is_full_entropy_code
    code = vendor_service.new_vendor_code()
    assert code.startswith("VND-") and is_full_entropy_code(code) and len(code) == 20


def test_matrix_assign_role_refuses_vendor_signups():
    src = inspect.getsource(users)
    assert "Vendor access is approved in the vendor platform" in src
    assert "models.User.role != Role.VENDOR.value" in src


async def test_vendor_project_queries_are_scoped_by_vendor(make_session, fake_result):
    db = make_session(fake_result(mappings_rows=[]))
    with pytest.raises(HTTPException) as e:
        await vendor_project_service.vendor_project_detail(db, tenant_id=TENANT, vendor_id=VENDOR, project_id=str(uuid.uuid4()))
    assert e.value.status_code == 404
    assert "p.tenant_id = :tid" in db.executed[0]
    assert db.execute_params[0]["vid"] == VENDOR


def test_portal_routes_take_the_vendor_from_the_session_never_the_request():
    from app.routers import vendor_portal
    for route in vendor_portal.router.routes:
        assert "vendor_id" not in inspect.signature(route.endpoint).parameters, route.path


def test_migration_is_additive_and_idempotent():
    sql = (Path(__file__).resolve().parents[1] / "database/migrations/20261104_vendor_platform_foundation.sql").read_text()
    assert "'business_admin', 'observer', 'supervisor', 'executive', 'vendor'" in sql
    creates = [line for line in sql.splitlines() if line.startswith("CREATE TABLE")]
    assert creates and all("IF NOT EXISTS" in c for c in creates)
    assert "uq_vendor_codes_live_code" in sql and "WHERE revoked_at IS NULL" in sql
    assert "DROP TABLE" not in sql.upper()
