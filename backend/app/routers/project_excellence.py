"""Project Excellence router — budget tracking module that opens after project completion."""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.deps import DbDep, TenantId
from app.domain.schemas.common import OkResponse
from app.domain.schemas.project import ProjectQueueResponse, ProjectStateResponse
from app.domain.schemas.project_excellence import (
    AdminBudgetReviewRequest,
    AllocatePERequest,
    PEBudgetAdminQueueResponse,
    PEDelegationsResponse,
    PEQueueResponse,
    PEStateResponse,
    ReviewRequest,
    SavePEBudgetRequest,
)
from app.rbac.guards import require_module, require_role
from app.rbac.roles import Role
from app.services.delegation_service import svc_assigned_sites, svc_is_delegated
from app.services.project_service import (
    svc_pe_complete_quality_audit,
    svc_pe_quality_audit_queue,
)
from app.services.project_excellence_service import (
    svc_admin_review_pe_budget,
    svc_allocate_pe,
    svc_get_pe,
    svc_get_pe_budget_admin_detail,
    svc_list_pe_delegations_for_site,
    svc_pe_budget_admin_queue,
    svc_pe_queue,
    svc_review_pe_budget,
    svc_revoke_pe_delegation,
    svc_save_pe_budget,
)

router = APIRouter(prefix="/project-excellence", tags=["Project Excellence"])

PEMember = Annotated[dict, Depends(require_role(Role.SUPERVISOR, Role.EXECUTIVE))]
PESupervisor = Annotated[dict, Depends(require_role(Role.SUPERVISOR))]
InPEModule = Annotated[dict, Depends(require_module("project_excellence"))]
BusinessAdmin = Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))]


def _is_executive(user: dict) -> bool:
    return (user.get("role") or "").lower() == Role.EXECUTIVE.value


@router.get("/queue", response_model=PEQueueResponse)
async def pe_queue(
    db: DbDep,
    current_user: PEMember,
    _module: InPEModule,
    tenant_id: TenantId,
    limit: int = Query(500, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> PEQueueResponse:
    restrict_to: Optional[list[str]] = None
    if _is_executive(current_user):
        restrict_to = await svc_assigned_sites(
            db, tenant_id=tenant_id, user_id=current_user["sub"], module="project_excellence",
        )
    return await svc_pe_queue(
        db, tenant_id=tenant_id, restrict_to_site_ids=restrict_to, limit=limit, offset=offset,
    )


@router.get("/quality-audit/queue", response_model=ProjectQueueResponse)
async def pe_quality_audit_queue(
    db: DbDep,
    current_user: PEMember,
    _module: InPEModule,
    tenant_id: TenantId,
) -> ProjectQueueResponse:
    """Sites awaiting the PE supervisor's quality-audit completion (+ recently done)."""
    # Scope executives to their allocated sites (supervisors see all) — same
    # pattern as pe_queue, so the QA tab can't leak unallocated sites.
    restrict_to: Optional[list[str]] = None
    if _is_executive(current_user):
        restrict_to = await svc_assigned_sites(
            db, tenant_id=tenant_id, user_id=current_user["sub"], module="project_excellence",
        )
    return await svc_pe_quality_audit_queue(db, tenant_id=tenant_id, restrict_to_site_ids=restrict_to)


@router.post("/{site_id}/quality-audit/complete", response_model=ProjectStateResponse)
async def pe_complete_quality_audit(
    site_id: str,
    db: DbDep,
    current_user: PESupervisor,
    _module: InPEModule,
    tenant_id: TenantId,
) -> ProjectStateResponse:
    """PE supervisor marks the quality audit Completed → project completes (records the date)."""
    return await svc_pe_complete_quality_audit(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
    )


@router.get("/budget-admin-queue", response_model=PEBudgetAdminQueueResponse)
async def pe_budget_admin_queue(
    db: DbDep,
    _auth: BusinessAdmin,
    tenant_id: TenantId,
) -> PEBudgetAdminQueueResponse:
    return await svc_pe_budget_admin_queue(db, tenant_id=tenant_id)


@router.get("/budget-admin-detail/{site_id}", response_model=PEStateResponse)
async def pe_budget_admin_detail(
    site_id: str,
    db: DbDep,
    _auth: BusinessAdmin,
    tenant_id: TenantId,
) -> PEStateResponse:
    return await svc_get_pe_budget_admin_detail(db, tenant_id=tenant_id, site_id=site_id)


@router.post("/{site_id}/budget/admin-review", response_model=PEStateResponse)
async def pe_budget_admin_review(
    site_id: str,
    body: AdminBudgetReviewRequest,
    db: DbDep,
    current_user: BusinessAdmin,
    tenant_id: TenantId,
) -> PEStateResponse:
    return await svc_admin_review_pe_budget(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body,
    )


@router.get("/{site_id}/delegations", response_model=PEDelegationsResponse)
async def list_pe_delegations(
    site_id: str,
    db: DbDep,
    current_user: PEMember,
    _module: InPEModule,
    tenant_id: TenantId,
) -> dict:
    if _is_executive(current_user):
        allowed = await svc_assigned_sites(
            db, tenant_id=tenant_id, user_id=current_user["sub"], module="project_excellence",
        )
        if site_id not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This site is not allocated to you.",
            )
    return await svc_list_pe_delegations_for_site(db, tenant_id=tenant_id, site_id=site_id)


@router.post("/{site_id}/allocate", response_model=PEStateResponse)
async def allocate_pe(
    site_id: str,
    body: AllocatePERequest,
    db: DbDep,
    current_user: PESupervisor,
    _module: InPEModule,
    tenant_id: TenantId,
) -> PEStateResponse:
    return await svc_allocate_pe(
        db,
        tenant_id=tenant_id,
        actor=current_user,
        site_id=site_id,
        delegate_user_id=body.executive_id,
        notes=body.notes,
    )


@router.delete("/{site_id}/allocate/{user_id}", response_model=OkResponse)
async def revoke_pe_allocation(
    site_id: str,
    user_id: str,
    db: DbDep,
    current_user: PESupervisor,
    _module: InPEModule,
    tenant_id: TenantId,
) -> OkResponse:
    return await svc_revoke_pe_delegation(
        db,
        tenant_id=tenant_id,
        actor=current_user,
        site_id=site_id,
        delegate_user_id=user_id,
    )


@router.post("/{site_id}/budget", response_model=PEStateResponse)
async def save_pe_budget(
    site_id: str,
    body: SavePEBudgetRequest,
    db: DbDep,
    current_user: PEMember,
    _module: InPEModule,
    tenant_id: TenantId,
) -> PEStateResponse:
    return await svc_save_pe_budget(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body,
    )


@router.post("/{site_id}/budget/review", response_model=PEStateResponse)
async def review_pe_budget(
    site_id: str,
    body: ReviewRequest,
    db: DbDep,
    current_user: PESupervisor,
    _module: InPEModule,
    tenant_id: TenantId,
) -> PEStateResponse:
    return await svc_review_pe_budget(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body,
    )


@router.get("/{site_id}", response_model=PEStateResponse)
async def get_pe(
    site_id: str,
    db: DbDep,
    current_user: PEMember,
    _module: InPEModule,
    tenant_id: TenantId,
) -> PEStateResponse:
    if _is_executive(current_user):
        ok = await svc_is_delegated(
            db, tenant_id=tenant_id, site_id=site_id, user_id=current_user["sub"], module="project_excellence",
        )
        if not ok:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    return await svc_get_pe(db, tenant_id=tenant_id, site_id=site_id)
