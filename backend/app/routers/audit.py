"""Audit router — tenant-wide and per-site activity feeds."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.deps import DbDep, TenantId
from app.domain.schemas.audit import AuditListResponse
from app.rbac.guards import require_role
from app.rbac.roles import Role
from app.services.query_service import list_site_activity, list_tenant_audit

router = APIRouter(prefix="/audit", tags=["Audit"])


@router.get(
    "",
    response_model=AuditListResponse,
    summary="Tenant-wide audit feed (supervisor only, paginated)",
)
async def list_audit_events(
    db: DbDep,
    _auth: Annotated[dict, Depends(require_role(Role.SUPERVISOR, Role.BUSINESS_ADMIN))],
    tenant_id: TenantId,
    page: int = Query(1, ge=1),
    limit: int = Query(50, le=200),
) -> AuditListResponse:
    return await list_tenant_audit(db, tenant_id=tenant_id, page=page, limit=limit)


@router.get(
    "/site/{site_id}",
    response_model=AuditListResponse,
    summary="Per-site audit feed (all authenticated roles, tenant-scoped)",
)
async def get_site_audit(
    site_id: str,
    db: DbDep,
    current_user: Annotated[
        dict, Depends(require_role(Role.EXECUTIVE, Role.SUPERVISOR, Role.BUSINESS_ADMIN))
    ],
    tenant_id: TenantId,
    module: str | None = Query(None, description="Optional module-scoped audit slice: legal, design, project, or nso"),
) -> AuditListResponse:
    from app.services._common import assert_executive_owns_site, fetch_site_or_404

    # #104 — BD executives only read the audit trail of their own/assigned
    # sites; non-BD module members keep access (their modules govern
    # visibility through delegation). Mirrors GET /sites/{id}/activity.
    site = await fetch_site_or_404(db, site_id=site_id, tenant_id=tenant_id)
    if (current_user.get("module") or "bd").lower() in ("", "bd"):
        assert_executive_owns_site(current_user, site)
    return await list_site_activity(db, tenant_id=tenant_id, site_id=site_id, module=module)
