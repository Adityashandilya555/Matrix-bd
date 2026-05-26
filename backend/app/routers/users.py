"""Users router — current user info and user management."""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, status
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


@router.get("/me", summary="Get current user")
async def get_me(current_user: CurrentUser) -> dict:
    return current_user


@router.get("", summary="List users in tenant (supervisor only)")
async def list_users(
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> dict:
    stmt = (
        select(models.User)
        .where(models.User.tenant_id == tenant_id, models.User.is_active.is_(True))
        .order_by(models.User.name)
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
) -> dict:
    stmt = (
        select(models.User)
        .where(models.User.tenant_id == tenant_id, models.User.is_active.is_(False))
        .order_by(models.User.email)
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
            SELECT id, email, name, role, is_active
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
    #    those claims.
    await db.execute(
        text("""
            UPDATE users
               SET role          = :role,
                   assigned_city = :city,
                   is_active     = true,
                   name          = COALESCE(:name, name)
             WHERE id = CAST(:uid AS uuid) AND tenant_id = :tid
        """),
        {"role": body.role, "city": body.city, "name": body.name, "uid": user_id, "tid": tenant_id},
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
