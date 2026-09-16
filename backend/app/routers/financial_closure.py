"""Financial Closure router — post-launch 'closure' budget phase (a tab in the
Project surface). Members are project supervisors/executives; the open + finalize
actions are business_admin."""
from __future__ import annotations

from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.deps import DbDep, TenantId
from app.domain.schemas.common import OkResponse
from app.domain.schemas.project import QAReportsResponse
from app.domain.schemas.financial_closure import (
    AllocateFCRequest,
    FCAdminReviewRequest,
    FCDelegationsResponse,
    FCQueueResponse,
    FCReviewRequest,
    FCStateResponse,
    SaveFCBudgetRequest,
)
from app.rbac.guards import require_module, require_role
from app.rbac.roles import Role
from app.services.delegation_service import svc_assigned_sites, svc_is_delegated
from app.services.financial_closure_service import (
    svc_admin_finalize_fc,
    svc_allocate_fc,
    svc_fc_admin_queue,
    svc_fc_queue,
    svc_get_fc,
    svc_get_fc_admin_detail,
    svc_list_fc_delegations_for_site,
    svc_review_fc_budget,
    svc_revoke_fc_delegation,
    svc_save_fc_budget,
    svc_send_for_financial_closure,
)
from app.services.project_service import svc_qa_reports_for_site

router = APIRouter(prefix="/financial-closure", tags=["Financial Closure"])

FCMember = Annotated[dict, Depends(require_role(Role.SUPERVISOR, Role.EXECUTIVE))]
# The queue is also the business admin's whole-tenant view of closure. Reading it
# is not the same privilege as acting on a closure, which stays SUPERVISOR-only
# below. svc_fc_queue narrows by allocation only for an EXECUTIVE, so an admin
# gets the unscoped tenant list without any extra branch.
FCReader = Annotated[dict, Depends(require_role(Role.SUPERVISOR, Role.EXECUTIVE, Role.BUSINESS_ADMIN))]
FCSupervisor = Annotated[dict, Depends(require_role(Role.SUPERVISOR))]
InProjectModule = Annotated[dict, Depends(require_module("project"))]
BusinessAdmin = Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))]

_MODULE = "financial_closure"


def _is_executive(user: dict) -> bool:
    return (user.get("role") or "").lower() == Role.EXECUTIVE.value


@router.post("/{site_id}/send", response_model=FCStateResponse)
async def send_for_financial_closure(
    site_id: str, db: DbDep, current_user: BusinessAdmin, tenant_id: TenantId,
) -> FCStateResponse:
    """Admin opens Financial Closure for a launched site (the 'Send for financial closure' button)."""
    return await svc_send_for_financial_closure(db, tenant_id=tenant_id, actor=current_user, site_id=site_id)


@router.get("/queue", response_model=FCQueueResponse)
async def fc_queue(
    db: DbDep, current_user: FCReader, tenant_id: TenantId,
    limit: int = Query(500, ge=1, le=1000), offset: int = Query(0, ge=0),
    closed: Optional[bool] = Query(None),
) -> FCQueueResponse:
    """The closure queue for supervisors, executives and the business admin.

    No require_module("project") gate, unlike every other endpoint on this
    router. The Launch Sites page shows this queue as a tab, and that page has
    no module gate of its own — its supervisors and executives hold whichever
    module they were onboarded into, so the project gate 403'd nearly all of
    them. Reading which sites are in closure, and who owes the next action, is
    not project-module-privileged; ACTING on a closure still is, and every
    mutating endpoint below keeps its gate.

    The role guard and the executive scoping below are what actually contain
    this: an executive still sees only the sites allocated to them.
    """
    restrict_to: Optional[list[str]] = None
    if _is_executive(current_user):
        restrict_to = await svc_assigned_sites(db, tenant_id=tenant_id, user_id=current_user["sub"], module=_MODULE)
    return await svc_fc_queue(
        db, tenant_id=tenant_id, restrict_to_site_ids=restrict_to,
        limit=limit, offset=offset, closed=closed,
    )


@router.get("/admin-queue", response_model=FCQueueResponse)
async def fc_admin_queue(
    db: DbDep, _auth: BusinessAdmin, tenant_id: TenantId,
    limit: int = Query(500, ge=1, le=1000), offset: int = Query(0, ge=0),
) -> FCQueueResponse:
    return await svc_fc_admin_queue(db, tenant_id=tenant_id, limit=limit, offset=offset)


@router.get("/admin-detail/{site_id}", response_model=FCStateResponse)
async def fc_admin_detail(
    site_id: str, db: DbDep, _auth: BusinessAdmin, tenant_id: TenantId,
) -> FCStateResponse:
    return await svc_get_fc_admin_detail(db, tenant_id=tenant_id, site_id=site_id)


@router.get("/admin-detail/{site_id}/qa-reports", response_model=QAReportsResponse)
async def fc_admin_qa_reports(
    site_id: str, db: DbDep, _auth: BusinessAdmin, tenant_id: TenantId,
) -> QAReportsResponse:
    """The before/after quality-audit report PDFs (signed URLs) for the admin's
    Financial Closure review card. Reuses the actor-agnostic project-side
    service; the project route is project-module-gated, so the admin needs its
    own. Read-only, does not mark viewed."""
    return await svc_qa_reports_for_site(db, tenant_id=tenant_id, site_id=site_id)


@router.post("/{site_id}/finalize", response_model=FCStateResponse)
async def finalize_financial_closure(
    site_id: str, body: FCAdminReviewRequest, db: DbDep, current_user: BusinessAdmin, tenant_id: TenantId,
) -> FCStateResponse:
    """The admin's Financial Closure button — records closure + archives to history."""
    return await svc_admin_finalize_fc(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body)


@router.get("/{site_id}/delegations", response_model=FCDelegationsResponse)
async def list_fc_delegations(
    site_id: str, db: DbDep, current_user: FCMember, _module: InProjectModule, tenant_id: TenantId,
) -> dict:
    if _is_executive(current_user):
        allowed = await svc_assigned_sites(db, tenant_id=tenant_id, user_id=current_user["sub"], module=_MODULE)
        if site_id not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This site is not allocated to you.")
    return await svc_list_fc_delegations_for_site(db, tenant_id=tenant_id, site_id=site_id)


@router.post("/{site_id}/allocate", response_model=FCStateResponse)
async def allocate_fc(
    site_id: str, body: AllocateFCRequest, db: DbDep, current_user: FCSupervisor, _module: InProjectModule, tenant_id: TenantId,
) -> FCStateResponse:
    return await svc_allocate_fc(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, delegate_user_id=body.executive_id, notes=body.notes)


@router.delete("/{site_id}/allocate/{user_id}", response_model=OkResponse)
async def revoke_fc_allocation(
    site_id: str, user_id: str, db: DbDep, current_user: FCSupervisor, _module: InProjectModule, tenant_id: TenantId,
) -> OkResponse:
    return await svc_revoke_fc_delegation(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, delegate_user_id=user_id)


@router.post("/{site_id}/budget", response_model=FCStateResponse)
async def save_fc_budget(
    site_id: str, body: SaveFCBudgetRequest, db: DbDep, current_user: FCMember, _module: InProjectModule, tenant_id: TenantId,
) -> FCStateResponse:
    return await svc_save_fc_budget(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body)


@router.post("/{site_id}/budget/review", response_model=FCStateResponse)
async def review_fc_budget(
    site_id: str, body: FCReviewRequest, db: DbDep, current_user: FCSupervisor, _module: InProjectModule, tenant_id: TenantId,
) -> FCStateResponse:
    return await svc_review_fc_budget(db, tenant_id=tenant_id, actor=current_user, site_id=site_id, body=body)


@router.get("/{site_id}/qa-reports", response_model=QAReportsResponse)
async def fc_qa_reports(
    site_id: str, db: DbDep, current_user: FCReader, tenant_id: TenantId,
) -> QAReportsResponse:
    """Quality-audit reports for a site, read-only.

    A sibling of admin-detail/{site_id}/qa-reports, not a replacement: that one
    is BUSINESS_ADMIN, and the project / project_excellence routes returning the
    same payload each require their own module claim. A Launch Sites supervisor
    holds none of those, so before this route every way of reading a QA report
    403'd for them — and the closure drawer they open from that page is exactly
    where the reports are wanted.

    Hence FCReader and no require_module, the same shape as the queue above and
    as project_excellence's DocMember, whose comment makes the same argument for
    attachments read from two surfaces.

    The executive check below is what keeps this narrow, and mirrors get_fc: an
    executive not delegated onto the site gets 404 rather than a signed URL they
    could otherwise mint by guessing site ids.
    """
    if _is_executive(current_user):
        ok = await svc_is_delegated(db, tenant_id=tenant_id, site_id=site_id, user_id=current_user["sub"], module=_MODULE)
        if not ok:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    return await svc_qa_reports_for_site(db, tenant_id=tenant_id, site_id=site_id)


@router.get("/{site_id}", response_model=FCStateResponse)
async def get_fc(
    site_id: str, db: DbDep, current_user: FCMember, tenant_id: TenantId,
) -> FCStateResponse:
    """One closure record, read-only.

    No require_module("project") gate, for the same reason as /queue above: the
    Launch Sites page reads a closed closure from its Financial Closure tab, and
    that page has no module gate, so its supervisors and executives hold
    whichever module they were onboarded into.

    This one is narrower than the queue looks, because the executive check below
    is PER SITE: an executive who is not delegated onto a site gets 404, module
    claim or not. Writes are unaffected and stay project-gated.
    """
    if _is_executive(current_user):
        ok = await svc_is_delegated(db, tenant_id=tenant_id, site_id=site_id, user_id=current_user["sub"], module=_MODULE)
        if not ok:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
    return await svc_get_fc(db, tenant_id=tenant_id, site_id=site_id)
