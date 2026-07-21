"""Project Excellence router — budget tracking module that opens after project completion."""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status

from app.core.deps import DbDep, TenantId
from app.core.uploads import read_upload_capped
from app.domain.schemas.common import OkResponse
from app.domain.schemas.project import (
    ProjectDelegationsResponse,
    ProjectQueueResponse,
    ProjectStateResponse,
)
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
    svc_allocate_qa,
    svc_list_qa_delegations_for_site,
    svc_pe_complete_quality_audit,
    svc_pe_quality_audit_queue,
    svc_push_qa_report,
    svc_record_qa_report,
    svc_revoke_qa_delegation,
)
from app.services.storage_service import safe_object_name, upload_bytes as storage_upload
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
# Excellence-document attachments are read/written from BOTH the PE review page
# and the Financial Closure page (business_admin), so this guard is role-based
# and NOT gated on PE module membership.
DocMember = Annotated[
    dict, Depends(require_role(Role.SUPERVISOR, Role.EXECUTIVE, Role.BUSINESS_ADMIN))
]

# Attachments are images or PDFs, capped well below the global 25 MB limit.
_EXCELLENCE_ALLOWED_MIME = {"image/png", "image/jpeg", "application/pdf"}
_EXCELLENCE_MAX_BYTES = 5 * 1024 * 1024


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
    # pattern as pe_queue, so the QA tab can't leak unallocated sites. Union in
    # sites whose QA-report task is delegated to them (module='quality_audit'),
    # which is a separate scope from the PE site allocation.
    restrict_to: Optional[list[str]] = None
    if _is_executive(current_user):
        pe_sites = await svc_assigned_sites(
            db, tenant_id=tenant_id, user_id=current_user["sub"], module="project_excellence",
        )
        qa_sites = await svc_assigned_sites(
            db, tenant_id=tenant_id, user_id=current_user["sub"], module="quality_audit",
        )
        restrict_to = list({*pe_sites, *qa_sites})
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


@router.post("/{site_id}/quality-audit/report/{kind}/upload", response_model=ProjectStateResponse)
async def upload_qa_report(
    site_id: str,
    kind: str,
    db: DbDep,
    current_user: PEMember,
    _module: InPEModule,
    tenant_id: TenantId,
    file: UploadFile = File(...),
) -> ProjectStateResponse:
    """Upload a quality-audit report PDF (kind='before'|'after') to storage.
    PDF-only, ≤25 MB. Supervisor or the QA-delegated executive."""
    from uuid import uuid4

    if kind not in ("before", "after"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="kind must be 'before' or 'after'.")
    body_bytes = await read_upload_capped(file)
    if (file.content_type or "") != "application/pdf":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only PDF files are accepted for quality-audit reports.",
        )
    await db.rollback()  # free the connection for the slow storage call
    safe_name = safe_object_name(file.filename or "report.pdf", fallback="report.pdf")
    path = f"quality-audit/{tenant_id}/{site_id}/{kind}/{uuid4().hex[:8]}_{safe_name}"
    await storage_upload(path=path, body=body_bytes, content_type="application/pdf")
    return await svc_record_qa_report(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
        kind=kind, file_key=path, file_name=safe_name,
    )


@router.post("/{site_id}/quality-audit/report/{kind}/push", response_model=ProjectStateResponse)
async def push_qa_report(
    site_id: str,
    kind: str,
    db: DbDep,
    current_user: PEMember,
    _module: InPEModule,
    tenant_id: TenantId,
) -> ProjectStateResponse:
    """Push a quality-audit report — 'before' completes the project; 'after'
    follows a pushed 'before' and re-flags the reports unread for Project."""
    return await svc_push_qa_report(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, kind=kind,
    )


@router.get("/{site_id}/quality-audit/delegations", response_model=ProjectDelegationsResponse)
async def qa_delegations(
    site_id: str,
    db: DbDep,
    _auth: PEMember,
    _module: InPEModule,
    tenant_id: TenantId,
) -> dict:
    """Active quality-audit-report delegations for a site (supervisor view)."""
    return await svc_list_qa_delegations_for_site(db, tenant_id=tenant_id, site_id=site_id)


@router.post("/{site_id}/quality-audit/allocate", response_model=OkResponse)
async def allocate_qa(
    site_id: str,
    body: AllocatePERequest,
    db: DbDep,
    current_user: PESupervisor,
    _module: InPEModule,
    tenant_id: TenantId,
) -> OkResponse:
    """Delegate the quality-audit-report task for a site to an executive (or self)."""
    return await svc_allocate_qa(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
        delegate_user_id=body.executive_id, notes=body.notes,
    )


@router.delete("/{site_id}/quality-audit/allocate/{user_id}", response_model=OkResponse)
async def revoke_qa_allocation(
    site_id: str,
    user_id: str,
    db: DbDep,
    current_user: PESupervisor,
    _module: InPEModule,
    tenant_id: TenantId,
) -> OkResponse:
    """Revoke a site's quality-audit-report delegation."""
    return await svc_revoke_qa_delegation(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id, delegate_user_id=user_id,
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


# ── Excellence document attachments (shared PE ↔ Financial Closure) ──────────

@router.get("/{site_id}/documents", summary="List a site's project-excellence attachments")
async def list_excellence_documents(
    site_id: str,
    db: DbDep,
    current_user: DocMember,
    tenant_id: TenantId,
) -> dict:
    """Image attachments (file_type='excellence') for a site, newest first, with
    freshly signed download URLs. Shown in both the PE review page and the
    Financial Closure page."""
    from app.services.site_documents_service import get_site_documents
    return await get_site_documents(
        db, site_id=site_id, tenant_id=tenant_id, current_user=current_user,
        file_type="excellence",
    )


@router.post("/{site_id}/documents", summary="Upload a project-excellence attachment (PNG/JPEG/PDF, ≤5 MB)")
async def upload_excellence_document(
    site_id: str,
    db: DbDep,
    current_user: DocMember,
    tenant_id: TenantId,
    file: UploadFile = File(...),
) -> dict:
    """Attach a PNG/JPEG image or PDF (≤5 MB) to the site's excellence document
    set. Available from the PE review page and the Financial Closure page; more
    files can be added at any time."""
    content_type = (file.content_type or "").lower()
    if content_type not in _EXCELLENCE_ALLOWED_MIME:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Only PNG, JPEG or PDF files are allowed.",
        )
    body_bytes = await read_upload_capped(file, max_bytes=_EXCELLENCE_MAX_BYTES)
    from app.services.photo_service import svc_upload_site_file
    return await svc_upload_site_file(
        db, tenant_id=tenant_id, actor=current_user, site_id=site_id,
        filename=file.filename or "attachment.jpg",
        content_type=file.content_type, file_bytes=body_bytes,
        file_type="excellence", path_prefix="excellence",
        audit_action="upload_excellence_doc",
    )
