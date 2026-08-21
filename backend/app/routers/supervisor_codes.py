"""Per-supervisor invite codes + pending-executive approvals.

Each supervisor owns their own invite code per module (bd / legal / payment).
Executives sign up via that code and land in a pending bucket the owning
supervisor approves from /team. See `services.supervisor_code_service`.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.domain.schemas.supervisor_codes import (
    AvailableExecutiveOut,
    InviteCodeOut,
    Module,
    PendingExecOut,
    TeamMemberOut,
)
from app.rbac.guards import require_role
from app.rbac.roles import Role
from app.services import supervisor_code_service as svc

router = APIRouter(prefix="/supervisor-codes", tags=["supervisor-codes"])


@router.get("/me/{module}", response_model=InviteCodeOut | None)
async def get_my_code(
    module: Module,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return await svc.get_my_code(db, current_user["sub"], module)


@router.post("/me/{module}/rotate", response_model=InviteCodeOut)
async def rotate_my_code(
    module: Module,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return await svc.rotate_my_code(db, current_user["tenant_id"], current_user["sub"], module)


@router.get("/me/{module}/pending-executives", response_model=list[PendingExecOut])
async def list_my_pending_execs(
    module: Module,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return await svc.list_my_pending_execs(db, current_user["sub"], module)


@router.get("/me/{module}/team", response_model=list[TeamMemberOut])
async def list_my_team(
    module: Module,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    return await svc.list_my_team(db, current_user, module)


@router.post("/me/pending-executives/{user_id}/approve", status_code=status.HTTP_204_NO_CONTENT)
async def approve_my_pending_exec(
    user_id: str,
    module: Module,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await svc.approve_my_pending_exec(
        db, current_user["tenant_id"], current_user["sub"], user_id, module,
    )


@router.post("/me/pending-executives/{user_id}/reject", status_code=status.HTTP_204_NO_CONTENT)
async def reject_my_pending_exec(
    user_id: str,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    await svc.reject_my_pending_exec(db, current_user["tenant_id"], user_id, current_user["sub"])


# ── Sharing an executive between supervisors ────────────────────────────────
#
# An executive may report to several supervisors in one module. The link is made
# from this side rather than by the executive redeeming a second invite code:
# _enqueue_signup 409s on an already-active email, so a second redemption never
# reaches an approval queue at all. See supervisor_code_service.


@router.get("/me/{module}/available-executives", response_model=list[AvailableExecutiveOut])
async def list_available_executives(
    module: Module,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Executives already in this module who are not yet on my team."""
    return await svc.list_available_executives(db, current_user, module)


@router.post("/me/{module}/team/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def add_existing_executive(
    module: Module,
    user_id: str,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    """Also supervise an executive who is already in this module. Idempotent."""
    await svc.add_existing_executive(db, current_user, module, user_id)


@router.delete("/me/{module}/team/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_from_my_team(
    module: Module,
    user_id: str,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    """Drop my own link only — other supervisors keep theirs, and the account
    stays active."""
    await svc.remove_from_my_team(db, current_user, module, user_id)
