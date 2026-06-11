"""Project Execution router."""
from __future__ import annotations

from datetime import date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.core.deps import DbDep, TenantId
from app.core.uploads import read_upload_capped
from app.domain.schemas.common import OkResponse
from app.domain.schemas.project import (
    AdminBudgetReviewRequest,
    AllocateProjectRequest,
    InitializationFinalizeRequest,
    InitializationRespondRequest,
    MidVisitRequest,
    MilestoneRequest,
    ProjectBudgetAdminQueueResponse,
    ProjectDelegationsResponse,
    ProjectHistoryResponse,
    ProjectQueueResponse,
    ProjectStateResponse,
    ReviewRequest,
    SaveBudgetRequest,
)
from app.rbac.guards import require_module, require_role
from app.rbac.roles import Role
from app.services.delegation_service import svc_assigned_sites, svc_is_delegated
from app.services.project_service import (
    svc_admin_review_budget,
    svc_allocate_project,
    svc_budget_admin_queue,
    svc_finalize_initialization,
    svc_get_project,
    svc_get_project_budget_admin_detail,
    svc_get_project_history_detail,
    svc_list_project_delegations_for_site,
    svc_nso_queue,
    svc_project_queue,
    svc_project_history,
    svc_respond_initialization,
    svc_review_budget,
    svc_review_milestone,
    svc_review_quality_audit,
    svc_revoke_project_delegation,
    svc_save_budget,
    svc_set_mid_visit,
    svc_submit_milestone,
    svc_submit_quality_audit_report,
)

router = APIRouter(prefix="/project", tags=["Project"])

ProjectMember = Annotated[dict, Depends(require_role(Role.SUPERVISOR, Role.EXECUTIVE))]
ProjectSupervisor = Annotated[dict, Depends(require_role(Role.SUPERVISOR))]
InProjectModule = Annotated[dict, Depends(require_module("project"))]
BusinessAdmin = Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))]


def _is_executive(user: dict) -> bool:
    return (user.get("role") or "").lower() == Role.EXECUTIVE.value


@router.get("/queue", response_model=ProjectQueueResponse)
async def project_queue(
    db: DbDep,
    current_user: ProjectMember,
    _module: InProjectModule,
    tenant_id: TenantId,
) -> ProjectQueueResponse:
    restrict_to: Optional[list[str]] = None
    if _is_executive(current_user):
        restrict_to = await svc_assigned_sites(
            db, tenant_id=tenant_id, user_id=current_user["sub"], module="project",
        )
    return await svc_project_queue(db, tenant_id=tenant_id, restrict_to_site_ids=restrict_to)


@router.get("/history", response_model=ProjectHistoryResponse)
async def project_history(
    db: DbDep,
    current_user: ProjectMember,
    _module: InProjectModule,
    tenant_id: TenantId,
    status_filter: str = "all",
) -> ProjectHistoryResponse:
    # Executives only see project history for sites delegated to them. Supervisors see all.
    restrict_to: Optional[list[str]] = None
    if _is_executive(current_user):
        restrict_to = await svc_assigned_sites(
            db, tenant_id=tenant_id, user_id=current_user["sub"], module="project",
        )
    return await svc_project_history(
        db, tenant_id=tenant_id, status_filter=status_filter, restrict_to_site_ids=restrict_to,
    )


@router.get("/history/{site_id}", response_model=ProjectStateResponse)
async def project_history_detail(
    site_id: str,
    db: DbDep,
    current_user: ProjectMember,
    _module: InProjectModule,
    tenant_id: TenantId,
) -> ProjectStateResponse:
    return await svc_get_project_history_detail(db, tenant_id=tenant_id, site_id=site_id)


@router.get("/budget-admin-queue", response_model=ProjectBudgetAdminQueueResponse)
async def project_budget_admin_queue(
    db: DbDep,
    current_user: BusinessAdmin,
    tenant_id: TenantId,
) -> ProjectBudgetAdminQueueResponse:
    return await svc_budget_admin_queue(db, tenant_id=tenant_id)


@router.get("/budget-admin-detail/{site_id}", response_model=ProjectStateResponse)
async def project_budget_admin_detail(
    site_id: str,
    db: DbDep,
    current_user: BusinessAdmin,
    tenant_id: TenantId,
) -> ProjectStateResponse:
    return await svc_get_project_budget_admin_detail(db, tenant_id=tenant_id, site_id=site_id)


@router.post("/{site_id}/budget/admin-review", response_model=ProjectStateResponse)
async def project_budget_admin_review(
    site_id: str,
    body: AdminBudgetReviewRequest,
    db: DbDep,
    current_user: BusinessAdmin,
    tenant_id: TenantId,
) -> ProjectStateResponse:
    return await svc_admin_review_budget(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body,
    )


@router.get("/nso-queue", response_model=ProjectQueueResponse)
async def project_nso_queue(
    db: DbDep,
    current_user: ProjectMember,
    _module: InProjectModule,
    tenant_id: TenantId,
) -> ProjectQueueResponse:
    """Sites completed in Project and pushed to NSO (handoff queue)."""
    return await svc_nso_queue(db, tenant_id=tenant_id)


@router.get("/{site_id}/delegations", response_model=ProjectDelegationsResponse)
async def list_project_delegations(
    site_id: str,
    db: DbDep,
    current_user: ProjectMember,
    _module: InProjectModule,
    tenant_id: TenantId,
) -> dict:
    return await svc_list_project_delegations_for_site(db, tenant_id=tenant_id, site_id=site_id)


@router.post("/{site_id}/allocate", response_model=ProjectStateResponse)
async def allocate_project(
    site_id: str,
    body: AllocateProjectRequest,
    db: DbDep,
    current_user: ProjectSupervisor,
    _module: InProjectModule,
    tenant_id: TenantId,
) -> ProjectStateResponse:
    return await svc_allocate_project(
        db,
        tenant_id=tenant_id,
        actor=current_user,
        site_id=site_id,
        delegate_user_id=body.executive_id,
        notes=body.notes,
    )


@router.delete("/{site_id}/allocate/{user_id}", response_model=OkResponse)
async def revoke_project_allocation(
    site_id: str,
    user_id: str,
    db: DbDep,
    current_user: ProjectSupervisor,
    _module: InProjectModule,
    tenant_id: TenantId,
) -> OkResponse:
    return await svc_revoke_project_delegation(
        db,
        tenant_id=tenant_id,
        actor=current_user,
        site_id=site_id,
        delegate_user_id=user_id,
    )


@router.post("/{site_id}/budget", response_model=ProjectStateResponse)
async def save_project_budget(
    site_id: str,
    body: SaveBudgetRequest,
    db: DbDep,
    current_user: ProjectMember,
    _module: InProjectModule,
    tenant_id: TenantId,
) -> ProjectStateResponse:
    return await svc_save_budget(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body)


@router.post("/{site_id}/budget/review", response_model=ProjectStateResponse)
async def review_project_budget(
    site_id: str,
    body: ReviewRequest,
    db: DbDep,
    current_user: ProjectSupervisor,
    _module: InProjectModule,
    tenant_id: TenantId,
) -> ProjectStateResponse:
    return await svc_review_budget(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body)


@router.post("/{site_id}/milestone/{field}", response_model=ProjectStateResponse)
async def submit_project_milestone(
    site_id: str,
    field: str,
    body: MilestoneRequest,
    db: DbDep,
    current_user: ProjectMember,
    _module: InProjectModule,
    tenant_id: TenantId,
) -> ProjectStateResponse:
    return await svc_submit_milestone(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, field=field, body=body,
    )


@router.post("/{site_id}/milestone/{field}/review", response_model=ProjectStateResponse)
async def review_project_milestone(
    site_id: str,
    field: str,
    body: ReviewRequest,
    db: DbDep,
    current_user: ProjectSupervisor,
    _module: InProjectModule,
    tenant_id: TenantId,
) -> ProjectStateResponse:
    return await svc_review_milestone(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, field=field, body=body,
    )


@router.post("/{site_id}/initialization/respond", response_model=ProjectStateResponse)
async def respond_project_initialization(
    site_id: str,
    body: InitializationRespondRequest,
    db: DbDep,
    current_user: ProjectMember,
    _module: InProjectModule,
    tenant_id: TenantId,
) -> ProjectStateResponse:
    """Executive accepts/rejects the admin-proposed initialization date."""
    return await svc_respond_initialization(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body,
    )


@router.post("/{site_id}/initialization/finalize", response_model=ProjectStateResponse)
async def finalize_project_initialization(
    site_id: str,
    body: InitializationFinalizeRequest,
    db: DbDep,
    current_user: ProjectSupervisor,
    _module: InProjectModule,
    tenant_id: TenantId,
) -> ProjectStateResponse:
    """Supervisor sets the final initialization date after an executive rejection."""
    return await svc_finalize_initialization(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body,
    )


@router.post("/{site_id}/mid-project-visit", response_model=ProjectStateResponse)
async def set_project_mid_visit(
    site_id: str,
    body: MidVisitRequest,
    db: DbDep,
    current_user: ProjectSupervisor,
    _module: InProjectModule,
    tenant_id: TenantId,
) -> ProjectStateResponse:
    """Supervisor sets the mid-project visit date."""
    return await svc_set_mid_visit(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body,
    )


@router.post("/{site_id}/quality-audit/upload", response_model=ProjectStateResponse)
async def upload_project_quality_audit(
    site_id: str,
    db: DbDep,
    current_user: ProjectMember,
    _module: InProjectModule,
    tenant_id: TenantId,
    file: UploadFile = File(...),
    inspection_date: Optional[str] = Form(None),
) -> ProjectStateResponse:
    """Executive uploads the quality-audit report + inspection date, then submits."""
    body_bytes = await read_upload_capped(file)
    safe_name = (file.filename or "quality_audit").replace("/", "_").replace("\\", "_")
    parsed_date: Optional[date] = None
    if inspection_date:
        try:
            parsed_date = date.fromisoformat(inspection_date)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid inspection date.")
    return await svc_submit_quality_audit_report(
        db,
        tenant_id=tenant_id,
        actor=current_user,
        site_id=site_id,
        filename=safe_name,
        content_type=file.content_type,
        file_bytes=body_bytes,
        inspection_date=parsed_date,
    )


@router.post("/{site_id}/quality-audit/review", response_model=ProjectStateResponse)
async def review_project_quality_audit(
    site_id: str,
    body: ReviewRequest,
    db: DbDep,
    current_user: ProjectSupervisor,
    _module: InProjectModule,
    tenant_id: TenantId,
) -> ProjectStateResponse:
    return await svc_review_quality_audit(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body,
    )


@router.get("/{site_id}", response_model=ProjectStateResponse)
async def get_project(
    site_id: str,
    db: DbDep,
    current_user: ProjectMember,
    _module: InProjectModule,
    tenant_id: TenantId,
) -> ProjectStateResponse:
    # Executives can only read a site delegated to them. Supervisors are unrestricted.
    if _is_executive(current_user):
        ok = await svc_is_delegated(
            db, tenant_id=tenant_id, site_id=site_id, user_id=current_user["sub"], module="project",
        )
        if not ok:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    return await svc_get_project(db, tenant_id=tenant_id, site_id=site_id)
