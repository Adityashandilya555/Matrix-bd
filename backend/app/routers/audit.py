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
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR, Role.BUSINESS_ADMIN))],
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
    return await list_site_activity(db, tenant_id=tenant_id, site_id=site_id, module=module)
