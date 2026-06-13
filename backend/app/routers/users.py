"""Users router — current user info and user management."""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, text

from app.core.deps import CurrentUser, DbDep, TenantId
from app.db import models
from app.rbac.guards import require_role
from app.rbac.roles import Role
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
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    # Bounded like notifications.py/audit.py — an unbounded scan + multi-MB JSON
    # per request degrades as a tenant accumulates users (#95).
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
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    stmt = (
        select(models.User)
        .where(models.User.tenant_id == tenant_id, models.User.is_active.is_(False))
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

    # 2. Activate the public.users row. The user's next /auth/login call will
    #    see is_active=true and the new role, and a JWT will be minted with
    #    those claims. Clear the pending-signup marker so it doesn't linger in
    #    `notes` and confuse the module approval queues (#121).
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

    # 2b. If this pending user came from a module-/supervisor-code signup, its
    #     intended module lived in `notes`. The module-gated routes and queues
    #     key off user_module_memberships, so provision that row here too —
    #     otherwise the login JWT carries module=None and the user is stranded
    #     (can act in no module AND has vanished from the module queues). (#121)
    membership = _membership_from_notes(user_row["notes"])
    if membership is not None:
        module, role_in_module, supervisor_id = membership
        await db.execute(
            text("""
                INSERT INTO user_module_memberships
                       (user_id, tenant_id, module, role_in_module, supervisor_id)
                VALUES (CAST(:uid AS uuid), :tid, :module, :rim, CAST(:sid AS uuid))
                ON CONFLICT (user_id, module) DO NOTHING
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
