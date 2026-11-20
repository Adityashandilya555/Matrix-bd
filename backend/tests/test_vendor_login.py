"""The login fork: after the workspace code, Retail (Matrix) or Vendor.

Retail requests carry no `platform` and run today's Matrix login unchanged.
The Vendor side uses the SAME tenant workspace code and signs in a vendor-role
user of that tenant, returning a token with role 'vendor' and the vendor_id.
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core.security import decode_token
from app.routers import auth

TENANT = str(uuid.uuid4())
VENDOR = str(uuid.uuid4())
USER = str(uuid.uuid4())
CODE = "BTOKAI-4F8A1C9E2B7D60A3"


def _row(**over):
    row = {
        "tenant_id": TENANT, "tenant_name": "Blue Tokai", "seat_limit": 10, "user_id": USER,
        "email": "owner@shreeji.example", "user_name": "Mr. Mehta", "role": "vendor", "is_active": True,
        "assigned_city": None, "password_hash": "$2b$12$hash",
    }
    row.update(over)
    return row


def _link(**over):
    link = {"vendor_id": VENDOR, "vendor_role": "owner", "vendor_name": "Shreeji Interiors", "vendor_status": "active"}
    link.update(over)
    return link


@pytest.fixture(autouse=True)
def _passwords_ok(monkeypatch):
    async def ok(*_a, **_k):
        return True
    monkeypatch.setattr(auth, "verify_password_async", ok)


def _login(platform=None, code=CODE, email="owner@shreeji.example", password="secret1"):
    return auth.LoginIn(email=email, workspace_code=code, password=password, platform=platform)


async def test_vendor_side_signs_in_with_the_workspace_code(make_session, fake_result):
    db = make_session(fake_result(mappings_rows=[_row()]), fake_result(mappings_rows=[_link()]))
    out = await auth.login(_login("vendor"), db)
    claims = decode_token(out.access_token)
    assert (claims["role"], claims["vendor_id"], claims["platform"], claims["module"]) == ("vendor", VENDOR, "vendor", None)
    assert out.user["vendor_name"] == "Shreeji Interiors"
    assert "FROM tenants t" in db.executed[0] and "vendor_users" in db.executed[1]


async def test_a_matrix_user_on_the_vendor_side_is_not_a_vendor(make_session, fake_result):
    db = make_session(fake_result(mappings_rows=[_row(role="supervisor")]))
    with pytest.raises(HTTPException) as e:
        await auth.login(_login("vendor"), db)
    assert e.value.status_code == 404 and "registered as a vendor" in e.value.detail
    assert len(db.executed) == 1          # no vendor-link lookup for a non-vendor
    with pytest.raises(HTTPException) as e:
        await auth.login(_login("vendor"), make_session(fake_result(mappings_rows=[_row(user_id=None, role=None)])))
    assert e.value.status_code == 404


async def test_a_vendor_on_the_retail_side_is_sent_to_vendor_login(make_session, fake_result):
    with pytest.raises(HTTPException) as e:
        await auth.login(_login(), make_session(fake_result(mappings_rows=[_row()])))
    assert e.value.status_code == 403 and "choose Vendor login" in e.value.detail


async def test_vendor_side_refuses_suspended_unlinked_and_holds_pending(make_session, fake_result):
    with pytest.raises(HTTPException) as e:
        await auth.login(_login("vendor"), make_session(fake_result(mappings_rows=[_row()]), fake_result(mappings_rows=[_link(vendor_status="suspended")])))
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        await auth.login(_login("vendor"), make_session(fake_result(mappings_rows=[_row()]), fake_result(mappings_rows=[])))
    assert e.value.status_code == 404
    pending = await auth.login(_login("vendor"), make_session(fake_result(mappings_rows=[_row(is_active=False)]), fake_result(mappings_rows=[_link()])))
    assert pending.status_code == 202
    with pytest.raises(HTTPException) as e:
        await auth.login(_login("vendor"), make_session(fake_result(mappings_rows=[_row(password_hash=None)]), fake_result(mappings_rows=[_link()])))
    assert e.value.status_code == 401 and "password yet" in e.value.detail


async def test_retail_request_runs_exactly_one_query_like_main(make_session, fake_result):
    matrix = _row(role="executive", email="exec@bluetokai.example")
    db = make_session(fake_result(mappings_rows=[matrix]), fake_result(mappings_rows=[{"module": "project", "role_in_module": "executive", "supervisor_id": None}]))
    out = await auth.login(_login(email="exec@bluetokai.example"), db)
    assert decode_token(out.access_token)["role"] == "executive"
    assert not any("vendor" in q for q in db.executed)


@pytest.mark.parametrize("platform", [None, "vendor"])
async def test_unknown_codes_get_the_same_reply_on_both_sides(platform, make_session, fake_result):
    soft = await auth.login(_login(platform, code="ACME-1A2B"), make_session(fake_result(mappings_rows=[])))
    assert soft.status_code == 202                       # legacy short code: soft reply, as on main
    with pytest.raises(HTTPException) as e:
        await auth.login(_login(platform, code="ACME-0123456789ABCDEF"), make_session(fake_result(mappings_rows=[])))
    assert e.value.status_code == 404


def _internal_request():
    return SimpleNamespace(headers={"X-Matrix-Internal": "1", "origin": "http://localhost:5173"})


@pytest.fixture
def _trusted(monkeypatch):
    monkeypatch.setattr(auth, "_is_trusted_internal", lambda _req: True)


async def test_login_check_answers_per_side(_trusted, make_session, fake_result):
    tenant = fake_result(mappings_rows=[{"id": TENANT}])
    vendor_user = {"is_active": True, "password_hash": "$2b$", "role": "vendor"}
    matrix_user = {"is_active": True, "password_hash": "$2b$", "role": "supervisor"}
    check = lambda platform: auth.LoginCheckIn(email="a@b.example", workspace_code=CODE, platform=platform)  # noqa: E731
    r = await auth.login_check(check(None), _internal_request(), make_session(tenant, fake_result(mappings_rows=[vendor_user])))
    assert r["account_state"] == "vendor_account"
    r = await auth.login_check(check("vendor"), _internal_request(), make_session(fake_result(mappings_rows=[{"id": TENANT}]), fake_result(mappings_rows=[vendor_user])))
    assert r["account_state"] == "active"
    r = await auth.login_check(check("vendor"), _internal_request(), make_session(fake_result(mappings_rows=[{"id": TENANT}]), fake_result(mappings_rows=[matrix_user])))
    assert r["account_state"] == "unknown"
    r = await auth.login_check(check(None), _internal_request(), make_session(fake_result(mappings_rows=[{"id": TENANT}]), fake_result(mappings_rows=[matrix_user])))
    assert r["account_state"] == "active"


async def test_login_check_stays_opaque_to_outside_callers(monkeypatch, make_session, fake_result):
    monkeypatch.setattr(auth, "_is_trusted_internal", lambda _req: False)
    vendor_user = {"is_active": True, "password_hash": "$2b$", "role": "vendor"}
    r = await auth.login_check(auth.LoginCheckIn(email="a@b.example", workspace_code=CODE), _internal_request(),
                               make_session(fake_result(mappings_rows=[{"id": TENANT}]), fake_result(mappings_rows=[vendor_user])))
    assert r == {"account_state": "checked"}


def _signup(code="VND-5A7C1E9B3D2F4086", ws=CODE, email="new@shreeji.example"):
    return auth.VendorSignupIn(email=email, workspace_code=ws, code=code)


async def test_vendor_signup_needs_a_live_staff_code_of_this_workspace(make_session, fake_result):
    staff = {"vendor_id": VENDOR, "tenant_id": TENANT, "vendor_status": "active"}
    db = make_session(fake_result(mappings_rows=[{"id": TENANT}]), fake_result(mappings_rows=[staff]), fake_result(mappings_rows=[]))
    out = await auth.signup_vendor(_signup(), db)
    assert out.message.startswith("Signup received")
    assert db.execute_params[1]["tid"] == TENANT          # the staff-code lookup is scoped to this workspace
    assert any("INSERT INTO vendor_users" in q for q in db.executed) and db.commit_count == 1
    for results in ([fake_result(mappings_rows=[])],                                            # unknown workspace
                    [fake_result(mappings_rows=[{"id": TENANT}]), fake_result(mappings_rows=[])],   # code not in this workspace
                    [fake_result(mappings_rows=[{"id": TENANT}]), fake_result(mappings_rows=[{**staff, "vendor_status": "suspended"}])]):
        with pytest.raises(HTTPException) as e:
            await auth.signup_vendor(_signup(), make_session(*results))
        assert e.value.status_code == 404 and "not valid for this workspace" in e.value.detail


async def test_vendor_signup_refuses_a_matrix_users_email(make_session, fake_result):
    staff = {"vendor_id": VENDOR, "tenant_id": TENANT, "vendor_status": "active"}
    matrix_user = {"id": USER, "is_active": False, "role": "executive"}
    with pytest.raises(HTTPException) as e:
        await auth.signup_vendor(_signup(email="exec@bluetokai.example"), make_session(
            fake_result(mappings_rows=[{"id": TENANT}]), fake_result(mappings_rows=[staff]), fake_result(mappings_rows=[matrix_user])))
    assert e.value.status_code == 409
