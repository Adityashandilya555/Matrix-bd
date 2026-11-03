"""Vendor sign-in from the shared workspace-code box.

A vendor ENTRY code is resolved only after the tenant lookup misses, so every
Matrix code keeps its exact path, and a vendor token carries role 'vendor'
plus the vendor_id.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.core.security import decode_token
from app.routers import auth, tenancy

TENANT = str(uuid.uuid4())
VENDOR = str(uuid.uuid4())
USER = str(uuid.uuid4())
CODE = "VND-9C2E7A41B03D5F68"


def _vendor_row(**over):
    row = {
        "tenant_id": TENANT, "tenant_name": "Blue Tokai", "vendor_id": VENDOR, "vendor_name": "Shreeji Interiors",
        "vendor_status": "active", "user_id": USER, "email": "owner@shreeji.example", "user_name": "Mr. Mehta",
        "role": "vendor", "is_active": True, "assigned_city": None, "password_hash": "$2b$12$hash",
    }
    row.update(over)
    return row


@pytest.fixture(autouse=True)
def _passwords_ok(monkeypatch):
    async def ok(*_a, **_k):
        return True
    monkeypatch.setattr(auth, "verify_password_async", ok)


def _login(code=CODE, email="owner@shreeji.example", password="secret1"):
    return auth.LoginIn(email=email, workspace_code=code, password=password)


async def test_vendor_code_signs_in_with_a_vendor_token(make_session, fake_result):
    db = make_session(fake_result(mappings_rows=[]), fake_result(mappings_rows=[_vendor_row()]))
    out = await auth.login(_login(), db)
    claims = decode_token(out.access_token)
    assert claims["role"] == "vendor"
    assert claims["vendor_id"] == VENDOR
    assert claims["platform"] == "vendor"
    assert claims["module"] is None
    assert out.user["vendor_name"] == "Shreeji Interiors"
    # The tenant lookup ran first; the vendor lookup only after it missed.
    assert "FROM tenants t" in db.executed[0] and "vendor_codes" in db.executed[1]


async def test_vendor_paths_refuse_suspended_unknown_and_pending(make_session, fake_result):
    with pytest.raises(HTTPException) as e:
        await auth.login(_login(), make_session(fake_result(mappings_rows=[]), fake_result(mappings_rows=[_vendor_row(vendor_status="suspended")])))
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        await auth.login(_login(), make_session(fake_result(mappings_rows=[]), fake_result(mappings_rows=[_vendor_row(user_id=None)])))
    assert e.value.status_code == 404
    pending = await auth.login(_login(), make_session(fake_result(mappings_rows=[]), fake_result(mappings_rows=[_vendor_row(is_active=False)])))
    assert pending.status_code == 202


async def test_unknown_legacy_code_never_tries_the_vendor_lookup(make_session, fake_result):
    db = make_session(fake_result(mappings_rows=[]))
    out = await auth.login(_login(code="ACME-1A2B"), db)
    assert out.status_code == 202          # the pre-#84 soft reply, unchanged
    assert len(db.executed) == 1


async def test_unknown_full_entropy_code_is_still_404(make_session, fake_result):
    db = make_session(fake_result(mappings_rows=[]), fake_result(mappings_rows=[]))
    with pytest.raises(HTTPException) as e:
        await auth.login(_login(code="ACME-0123456789ABCDEF"), db)
    assert e.value.status_code == 404


async def test_a_vendor_account_cannot_sign_in_with_the_tenant_code(make_session, fake_result):
    matrix_row = {"tenant_id": TENANT, "tenant_name": "Blue Tokai", "seat_limit": 10, "user_id": USER,
                  "email": "owner@shreeji.example", "user_name": "x", "role": "vendor", "is_active": True,
                  "assigned_city": None, "password_hash": "$2b$12$hash"}
    with pytest.raises(HTTPException) as e:
        await auth.login(_login(code="BTOKAI-4F8A1C9E2B7D60A3"), make_session(fake_result(mappings_rows=[matrix_row])))
    assert e.value.status_code == 403
    assert "vendor code" in e.value.detail


async def test_branding_reports_the_vendor_platform_only_after_a_tenant_miss(make_session, fake_result):
    vendor = {"vendor_id": VENDOR, "tenant_id": TENANT, "vendor_name": "Shreeji Interiors", "vendor_status": "active",
              "tenant_name": "Blue Tokai", "logo_path": None, "allow_self_signup": False, "has_staff_code": True}
    out = await tenancy.public_branding(CODE, make_session(fake_result(mappings_rows=[]), fake_result(mappings_rows=[vendor])))
    assert out == {"found": True, "name": "Shreeji Interiors", "logo_url": None, "platform": "vendor",
                   "brand": "Blue Tokai", "join_allowed": True}
    suspended = {**vendor, "vendor_status": "suspended"}
    gone = await tenancy.public_branding(CODE, make_session(fake_result(mappings_rows=[]), fake_result(mappings_rows=[suspended])))
    assert gone == {"found": False, "name": None, "logo_url": None}


async def test_vendor_signup_needs_a_live_joinable_code(make_session, fake_result):
    staff = {"vendor_id": VENDOR, "tenant_id": TENANT, "kind": "staff", "vendor_status": "active", "allow_self_signup": False}
    db = make_session(fake_result(mappings_rows=[staff]), fake_result(mappings_rows=[]))
    out = await auth.signup_vendor(auth.VendorSignupIn(email="new@shreeji.example", code="VND-5A7C1E9B3D2F4086"), db)
    assert out.message.startswith("Signup received")
    assert any("INSERT INTO vendor_users" in s for s in db.executed)
    assert db.commit_count == 1
    entry_no_self = {**staff, "kind": "entry"}
    with pytest.raises(HTTPException) as e:
        await auth.signup_vendor(auth.VendorSignupIn(email="x@y.example", code=CODE), make_session(fake_result(mappings_rows=[entry_no_self])))
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        await auth.signup_vendor(auth.VendorSignupIn(email="x@y.example", code="VND-5A7C1E9B3D2F4086"),
                                 make_session(fake_result(mappings_rows=[{**staff, "vendor_status": "suspended"}])))
    assert e.value.status_code == 404


async def test_vendor_signup_refuses_a_matrix_users_email(make_session, fake_result):
    staff = {"vendor_id": VENDOR, "tenant_id": TENANT, "kind": "staff", "vendor_status": "active", "allow_self_signup": False}
    matrix_user = {"id": USER, "is_active": False, "role": "executive"}
    with pytest.raises(HTTPException) as e:
        await auth.signup_vendor(auth.VendorSignupIn(email="exec@bluetokai.example", code="VND-5A7C1E9B3D2F4086"),
                                 make_session(fake_result(mappings_rows=[staff]), fake_result(mappings_rows=[matrix_user])))
    assert e.value.status_code == 409
