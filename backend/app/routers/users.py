"""Users router — current user info and user management."""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, text

from app.core.deps import CurrentUser, DbDep, TenantId
from app.db import models
from app.domain.schemas.module_access import ModuleAccessRequestIn, ModuleAccessStateOut
from app.rbac.guards import require_role
from app.rbac.roles import Role
from app.services import module_access_service as module_access_svc
from app.services.audit_service import write_audit_event

router = APIRouter(prefix="/users", tags=["Users"])

# Roles a supervisor is allowed to assign to a pending user. NOT exposed:
#   - 'supervisor' (only the platform admin creates supervisors at workspace approval)
#   - 'system'     (internal)
_ASSIGNABLE_ROLES = {"executive"}
# Alias the landing-page nomenclature into the canonical role values.
_ROLE_ALIASES = {
    "executive":      "executive",
    "bd_executive":   "executive",
    "bd-executive":   "executive",
    "bdexecutive":    "executive",
    "bd_person":      "executive",  # legacy alias
}


def _membership_from_notes(notes: Optional[str]) -> Optional[tuple[str, str, Optional[str]]]:
    """Decode a pending-signup `notes` marker into a module membership.

    Module-code / supervisor-code signups stash their intended module in
    `users.notes` until approval (see auth.py signup routes):

        pending_module:<m>                     → supervisor for module <m>
        pending_supervisor:<sid>|module:<m>    → executive under <sid> in <m>

    Returns ``(module, role_in_module, supervisor_id)`` or ``None`` for the
    generic (module-less) workspace-code signups. Used so the generic Team
    approval path also provisions the membership row module-gated routes need
    (#121) — otherwise the user activates with module=None and is stranded.
    """
    if not notes:
        return None
    notes = notes.strip()
    if notes.startswith("pending_supervisor:"):
        rest = notes[len("pending_supervisor:"):]
        sid, _, module = rest.partition("|module:")
        if sid and module:
            return (module, "executive", sid)
        return None
    if notes.startswith("pending_module:"):
        module = notes[len("pending_module:"):]
        if module:
            return (module, "supervisor", None)
    return None


@router.get("/me", summary="Get current user")
async def get_me(current_user: CurrentUser) -> dict:
    return current_user


@router.get("", summary="List users in tenant (supervisor only)")
async def list_users(
    db: DbDep,
    _auth: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    # Bounded query — unbounded scans degrade as a tenant accumulates users.
    stmt = (
        select(models.User)
        .where(models.User.tenant_id == tenant_id, models.User.is_active.is_(True))
        .order_by(models.User.name)
        .limit(limit)
        .offset(offset)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "items": [
            {
                "id": str(u.id),
                "name": u.name,
                "email": u.email,
                "role": u.role,
                "assigned_city": u.assigned_city,
            }
            for u in rows
        ],
        "total": len(rows),
    }


# ── Pending users / role assignment ────────────────────────────────────────


class AssignRoleRequest(BaseModel):
    role: str = Field(min_length=3, max_length=32)
    city: str = Field(min_length=1, max_length=80)
    name: Optional[str] = Field(default=None, max_length=120)

    @field_validator("role")
    @classmethod
    def _normalize_role(cls, v: str) -> str:
        normalized = _ROLE_ALIASES.get(v.strip().lower(), v.strip().lower())
        if normalized not in _ASSIGNABLE_ROLES:
            raise ValueError(
                "role must be one of: executive (aliases: bd_executive)"
            )
        return normalized


class AssignRoleOut(BaseModel):
    user_id: str
    role:    str
    city:    str
    message: str


@router.get("/pending", summary="Supervisor: list pending (unassigned) users in tenant")
async def list_pending_users(
    db: DbDep,
    _auth: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    stmt = (
        select(models.User)
        .where(
            models.User.tenant_id == tenant_id,
            models.User.is_active.is_(False),
            # Pending observers belong to the business admin's Observer access
            # section, not this queue. assign-role refuses them anyway; leaving
            # them listed would just be a row nobody here can action.
            models.User.role != Role.OBSERVER.value,
        )
        .order_by(models.User.email)
        .limit(limit)
        .offset(offset)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "items": [
            {
                "id":         str(u.id),
                "email":      u.email,
                "name":       u.name,
                "role":       u.role,
                "created_at": u.created_at.isoformat() if getattr(u, "created_at", None) else None,
            }
            for u in rows
        ],
        "total": len(rows),
    }


@router.post(
    "/{user_id}/assign-role",
    response_model=AssignRoleOut,
    summary="Supervisor: assign role to a pending user + generate invite link",
)
async def assign_role(
    user_id: str,
    body: AssignRoleRequest,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> AssignRoleOut:
    # 1. Confirm the pending user exists in this tenant.
    user_row = (await db.execute(
        text("""
            SELECT id, email, name, role, is_active, notes
              FROM users
             WHERE id = CAST(:uid AS uuid) AND tenant_id = :tid
             FOR UPDATE
        """),
        {"uid": user_id, "tid": tenant_id},
    )).mappings().first()
    if not user_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in this tenant.")
    if user_row["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User already has an assigned role.",
        )
    # A pending observer is the business admin's to approve, and only from the
    # Observer access section. Without this a module supervisor could take an
    # observer signup out of the shared pending queue and activate it as an
    # executive in their own module — turning a read-only invite into a writing
    # account, which is an escalation relative to the code that was redeemed.
    if user_row["role"] == Role.OBSERVER.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Observer access is approved by the business admin, not here.",
        )

    # 2. Activate the user row; clear the pending-signup marker from notes.
    await db.execute(
        text("""
            UPDATE users
               SET role          = :role,
                   assigned_city = :city,
                   is_active     = true,
                   notes         = NULL,
                   name          = COALESCE(:name, name)
             WHERE id = CAST(:uid AS uuid) AND tenant_id = :tid
        """),
        {"role": body.role, "city": body.city, "name": body.name, "uid": user_id, "tid": tenant_id},
    )

    # 2b. Provision module membership when the signup came from a module/supervisor code.
    membership = _membership_from_notes(user_row["notes"])
    if membership is not None:
        module, role_in_module, supervisor_id = membership
        await db.execute(
            text("""
                INSERT INTO user_module_memberships
                       (user_id, tenant_id, module, role_in_module, supervisor_id)
                VALUES (CAST(:uid AS uuid), :tid, :module, :rim, CAST(:sid AS uuid))
                -- No inference target: this one statement writes both a
                -- supervisor row (supervisor_id NULL) and an executive row,
                -- which land on different partial indexes.
                ON CONFLICT DO NOTHING
            """),
            {"uid": user_id, "tid": tenant_id, "module": module,
             "rim": role_in_module, "sid": supervisor_id},
        )

    # 3. Audit.
    await write_audit_event(
        db, tenant_id=tenant_id, site_id=None,
        actor_id=current_user["sub"], actor_name=current_user.get("name", ""),
        action="assign_role",
        entity_id=user_id, entity_type="user",
        detail=f"role={body.role} city={body.city}",
    )

    await db.commit()

    return AssignRoleOut(
        user_id=str(user_row["id"]),
        role=body.role,
        city=body.city,
        message=(
            f"{user_row['email']} is now {body.role} in {body.city}. "
            "They can sign in with their email + the workspace code."
        ),
    )


def _home_module(current_user: dict) -> Optional[str]:
    """The caller's OWN module.

    Never ``current_user["module"]``: that claim is rewritten to the borrowed
    module while a supervisor is inside another workspace, so reading it here
    would file a request — or render the access page — against someone else's
    module.

    There is deliberately no fallback to it. get_current_user sets home_module
    unconditionally, so a fallback could only fire when the JWT carries no
    module claim — and for that user `module` is precisely the header-supplied
    borrowed one, which is the value this helper exists to avoid. Callers
    already handle None.
    """
    return current_user.get("home_module")


def _assert_real_supervisor(current_user: dict) -> None:
    """The real guard on the supervisor self-service routes.

    ``require_role`` on the route sees the POST-override role, so a business
    admin simulating a supervisor would satisfy it and could request workspace
    grants for themselves. ``real_role`` is set from the DB and no header can
    rewrite it. The dependency is still declared on each route so the
    route-enumeration test in tests/test_observer_readonly.py needs no
    exception.
    """
    if current_user.get("real_role") != Role.SUPERVISOR.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only supervisors can use workspace access.",
        )


@router.post(
    "/me/request-executive-access",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Supervisor requests dual-role executive access",
)
async def request_executive_access(
    db: DbDep,
    current_user: CurrentUser,
    tenant_id: TenantId,
    # This was the only mutating route in the API with no role dependency — its
    # inline real_role check below was the sole guard. Declared here too so the
    # route-enumeration test in tests/test_observer_readonly.py needs no
    # exception for it. The inline check still stands: it tests real_role, which
    # the X-Override-Role header cannot rewrite, whereas require_role sees the
    # post-override role.
    _auth: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
) -> None:
    """Creates a pending request for the Business Admin to approve executive access."""
    if current_user.get("real_role") != "supervisor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only supervisors can request executive access.",
        )
    
    module = _home_module(current_user)
    if not module:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is not assigned to a module.",
        )

    if current_user.get("has_executive_access"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You already have executive access.",
        )

    q = """
        INSERT INTO supervisor_executive_requests (tenant_id, supervisor_id, module)
        VALUES (:tid, :uid, :mod)
        ON CONFLICT (supervisor_id, module) WHERE status = 'pending' DO NOTHING
    """
    await db.execute(text(q), {
        "tid": tenant_id,
        "uid": current_user["sub"],
        "mod": module,
    })
    await db.commit()


# ── Cross-module workspace access (migration 20260930) ───────────────────────
#
# A supervisor asks a business admin for supervisor access to another module.
# Approval writes no membership row — see module_access_service for why.

@router.get(
    "/me/module-access",
    response_model=list[ModuleAccessStateOut],
    summary="Modules this supervisor owns, holds access to, or may request",
)
async def list_my_module_access(
    db: DbDep,
    current_user: CurrentUser,
    tenant_id: TenantId,
    _auth: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
) -> list[dict]:
    _assert_real_supervisor(current_user)
    return await module_access_svc.list_my_module_access(
        db,
        supervisor_id=current_user["sub"],
        tenant_id=tenant_id,
        home_module=_home_module(current_user),
    )


@router.post(
    "/me/module-access/requests",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Request supervisor access to another module",
)
async def request_module_access(
    body: ModuleAccessRequestIn,
    db: DbDep,
    current_user: CurrentUser,
    tenant_id: TenantId,
    _auth: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
) -> None:
    _assert_real_supervisor(current_user)
    await module_access_svc.request_module_access(
        db,
        supervisor_id=current_user["sub"],
        tenant_id=tenant_id,
        home_module=_home_module(current_user),
        module=body.module,
        actor_name=current_user.get("name"),
    )
