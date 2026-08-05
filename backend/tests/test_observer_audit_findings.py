"""Findings from the post-implementation audit of the observer stack.

The read-everything grant in rbac/guards.py was justified against the 85 GET
routes that carry a role or module dependency — but not against the question
"do any of those GETs return a CREDENTIAL rather than data". Three of them did.

Each test here failed before the fix in the same commit.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.rbac.guards import require_real_role, require_role
from app.rbac.roles import READ_ALL_ROLES, Role

OBSERVER = {"role": "observer", "real_role": "observer"}
ADMIN = {"role": "business_admin", "real_role": "business_admin"}
# A business admin driving a module through the Workspace Access override. Its
# effective role is a supervisor; its real one is not.
SIMULATING_ADMIN = {"role": "supervisor", "real_role": "business_admin"}
SUPERVISOR = {"role": "supervisor", "real_role": "supervisor"}


# ── the join codes are credentials, not data ──────────────────────────────────

@pytest.mark.asyncio
async def test_the_ordinary_guard_really_does_admit_an_observer():
    """The premise. Without this the fix below would be guarding nothing."""
    assert await require_role(Role.BUSINESS_ADMIN)(current_user=OBSERVER) is OBSERVER


@pytest.mark.asyncio
async def test_an_observer_cannot_read_a_credential_route():
    """A department code onboards a supervisor, who can write. An observer that
    can read one has a way to cause writes by proxy — which is the whole thing
    the role is supposed to not have."""
    with pytest.raises(HTTPException) as exc:
        await require_real_role(Role.BUSINESS_ADMIN)(current_user=OBSERVER)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_the_business_admin_still_can():
    assert await require_real_role(Role.BUSINESS_ADMIN)(current_user=ADMIN) is ADMIN


@pytest.mark.asyncio
async def test_a_simulating_admin_still_can():
    """require_real_role must read past the override, or the code panel would
    break the moment an admin entered a module — they are still the admin."""
    got = await require_real_role(Role.BUSINESS_ADMIN)(current_user=SIMULATING_ADMIN)
    assert got is SIMULATING_ADMIN


@pytest.mark.asyncio
async def test_an_override_header_cannot_forge_the_real_role():
    """The attack the plain guard would have allowed: claim to be the admin."""
    forged = {"role": "business_admin", "real_role": "observer"}
    with pytest.raises(HTTPException):
        await require_real_role(Role.BUSINESS_ADMIN)(current_user=forged)


@pytest.mark.asyncio
async def test_a_supervisor_is_refused_as_before():
    with pytest.raises(HTTPException):
        await require_real_role(Role.BUSINESS_ADMIN)(current_user=SUPERVISOR)


@pytest.mark.asyncio
async def test_it_falls_back_to_role_for_actors_with_no_real_role():
    """Service-layer and test actors predate real_role; _common.py's
    actor_is_business_admin makes the same allowance."""
    legacy = {"role": "business_admin"}
    assert await require_real_role(Role.BUSINESS_ADMIN)(current_user=legacy) is legacy


def test_the_credential_routes_use_the_real_role_guard():
    """Named explicitly, because the difference between the two guards is one
    word and the consequence is every join code in the workspace."""
    import inspect

    from app.routers import business_admin as router_mod

    for fn in (router_mod.list_dept_codes, router_mod.get_observer_code):
        src = inspect.getsource(fn)
        assert "require_real_role(Role.BUSINESS_ADMIN)" in src, fn.__name__
        assert "Depends(require_role(" not in src, fn.__name__


def test_read_all_roles_is_unchanged_by_the_fix():
    """The bypass itself stays wide — the fix carves out specific routes, it
    does not narrow the grant. Narrowing it would 403 the portal."""
    assert READ_ALL_ROLES == frozenset({"business_admin", "observer"})


# ── the org payload carries the same codes ────────────────────────────────────

def test_list_org_can_withhold_the_codes():
    import inspect

    from app.services import business_admin_service as svc

    sig = inspect.signature(svc.list_org)
    assert "include_codes" in sig.parameters
    # Keyword-only and defaulted True: every existing caller keeps its codes.
    assert sig.parameters["include_codes"].default is True
    assert sig.parameters["include_codes"].kind is inspect.Parameter.KEYWORD_ONLY


def test_the_org_route_keys_the_codes_on_the_real_role():
    """The observer portal renders this exact payload, so the department tree
    must come through and the codes must not."""
    import inspect

    from app.routers.business_admin import get_org

    src = inspect.getsource(get_org)
    assert 'include_codes=current_user.get("real_role") == Role.BUSINESS_ADMIN.value' in src


# ── a pending observer is not a module supervisor's to activate ───────────────

def test_assign_role_refuses_a_pending_observer():
    """It could otherwise take an observer signup out of the shared pending
    queue and activate it as an executive in its own module — a read-only
    invite redeemed as a writing account."""
    import inspect

    from app.routers.users import assign_role

    src = inspect.getsource(assign_role)
    assert 'user_row["role"] == Role.OBSERVER.value' in src
    assert "HTTP_403_FORBIDDEN" in src


def test_the_shared_pending_queue_excludes_observers():
    import inspect

    from app.routers.users import list_pending_users

    assert "models.User.role != Role.OBSERVER.value" in inspect.getsource(list_pending_users)


# ── an approved observer must be visible, and revocable ───────────────────────

def test_active_observers_can_be_listed():
    """After approval the pending queue empties and an observer holds no module
    membership, so nothing else in the product lists one. An account that reads
    the whole workspace and that nobody can see is the wrong shape."""
    from app.services import business_admin_service as svc

    assert callable(svc.list_active_observers)


def test_revoke_deletes_rather_than_deactivating():
    """Flipping is_active would drop the row back into the PENDING query
    (role='observer' AND is_active=false), silently re-offering the revoked
    account for approval."""
    import inspect

    from app.services import business_admin_service as svc

    src = inspect.getsource(svc.revoke_observer)
    assert "DELETE FROM users" in src
    assert "is_active = true" in src   # only ever removes an APPROVED one
    assert "UPDATE" not in src


def test_revoke_is_scoped_to_the_tenant_and_the_role():
    import inspect

    from app.services import business_admin_service as svc

    src = inspect.getsource(svc.revoke_observer)
    assert "tenant_id = :tid" in src
    assert "role = 'observer'" in src
