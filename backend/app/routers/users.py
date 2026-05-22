"""Users router — current user info and user management."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select, update

from app.core.deps import CurrentUser, DbDep, TenantId
from app.db import models
from app.db.session import transaction
from app.domain.schemas.common import OkResponse
from app.rbac.guards import require_role
from app.rbac.roles import Role
from app.services.audit_service import write_audit_event

router = APIRouter(prefix="/users", tags=["Users"])


class AssignCityRequest(BaseModel):
    city: str


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


@router.post(
    "/{user_id}/assign-city",
    response_model=OkResponse,
    summary="Assign sub-supervisor city scope",
)
async def assign_sub_supervisor_city(
    user_id: str,
    body: AssignCityRequest,
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    tenant_id: TenantId,
) -> OkResponse:
    async with transaction(db):
        await db.execute(
            update(models.User)
            .where(models.User.id == user_id, models.User.tenant_id == tenant_id)
            .values(role=Role.SUB_SUPERVISOR.value, assigned_city=body.city)
        )
        await write_audit_event(
            db, tenant_id=tenant_id, site_id=None,
            actor_id=current_user["sub"], actor_name=current_user["name"],
            action="assign_sub_supervisor_city",
            entity_id=user_id, entity_type="user",
            detail=f"city={body.city}",
        )
    return OkResponse(message=f"User {user_id} assigned to city {body.city}")
