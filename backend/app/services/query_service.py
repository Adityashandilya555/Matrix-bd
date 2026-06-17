"""Read-side query helpers — list_sites, get_site, activity feed, audit list.

Splitting these out of bd_service keeps the write-side service file focused on
state machine transitions.
"""
from __future__ import annotations

import logging
from typing import Optional
from uuid import UUID

from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.domain.schemas.audit import AuditEvent, AuditListResponse
from app.domain.schemas.site import SiteListResponse, SiteResponse
from app.services._common import apply_role_scope, fetch_site_or_404, site_to_response

logger = logging.getLogger(__name__)


# Slice U3 adds a `stage` column on legal_dd_checklist + site_licensing
# (draft / pending_review / published). BD must only see published rows. Use
# getattr with a 'published' default so we keep working pre-U3.

_DD_BD_FIELDS = (
    "title_doc", "sanctioned_plan", "oc_cc", "commercial_use", "property_tax",
    "electricity", "fire_noc", "other_1", "other_2",
    "final_verdict", "rejection_reason",
)
_LICENSING_BD_FIELDS = (
    "fssai", "health_trade", "shops_estab_reg", "fire_noc", "storage_license",
)


def _row_stage(row) -> str:
    try:
        return getattr(row, "stage", "published") or "published"
    except Exception:  # pragma: no cover — defensive
        logger.exception(
            "query_service._row_stage: unexpected error reading stage — defaulting to 'published'",
        )
        return "published"


def _project_for_caller(row, fields: tuple[str, ...], *, module: Optional[str]) -> dict:
    if row is None:
        return {"stage": "absent", "items_visible": False}
    stage = _row_stage(row)
    bd_caller = (module or "").lower() == "bd"
    if bd_caller and stage != "published":
        return {"stage": stage, "items_visible": False}
    out = {"stage": stage, "items_visible": True}
    for f in fields:
        out[f] = getattr(row, f, None)
    return out


def project_dd_for_caller(row, *, module: Optional[str]) -> dict:
    """BD callers see published DD rows only; legal staff see everything."""
    return _project_for_caller(row, _DD_BD_FIELDS, module=module)


def project_licensing_for_caller(row, *, module: Optional[str]) -> dict:
    """BD callers see published licensing rows only; legal staff see everything."""
    return _project_for_caller(row, _LICENSING_BD_FIELDS, module=module)


async def list_sites(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    user: dict,
    status: Optional[str] = None,
    city: Optional[str] = None,
    limit: int = 200,
) -> SiteListResponse:
    stmt = select(models.Site).where(models.Site.tenant_id == tenant_id)
    if status:
        # Accept a comma-separated list so views spanning several statuses
        # (e.g. Payments: legal_review,legal_approved,pushed_to_payments) can
        # load in one request instead of one per status.
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        stmt = stmt.where(
            models.Site.status == statuses[0]
            if len(statuses) == 1
            else models.Site.status.in_(statuses)
        )
    if city:
        stmt = stmt.where(models.Site.city == city)
    stmt = apply_role_scope(stmt, model=models.Site, user=user)
    stmt = stmt.order_by(desc(models.Site.updated_at)).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()

    # Collect detail/project/approval rows first, then resolve all the user ids
    # (submitter + assignee + approver) in one names query.
    submitter_ids = {r.submitted_by for r in rows if r.submitted_by}
    assignee_ids = {r.assigned_to for r in rows if r.assigned_to}
    site_ids = [r.id for r in rows]
    detail_by_site = {}
    project_by_site = {}
    approval_by_site = {}
    nso_by_site = {}
    launch_by_site = {}
    if site_ids:
        d_stmt = select(models.SiteDetail).where(models.SiteDetail.site_id.in_(site_ids))
        details = (await session.execute(d_stmt)).scalars().all()
        detail_by_site = {d.site_id: d for d in details}
        p_stmt = select(models.ProjectReview).where(models.ProjectReview.site_id.in_(site_ids))
        projects = (await session.execute(p_stmt)).scalars().all()
        project_by_site = {p.site_id: p for p in projects}
        # Latest approval per site carries expected_loi_days + the approver, which
        # power the LOI SLA tracker (#115). desc(created_at) → first seen is newest.
        a_stmt = (
            select(models.Approval)
            .where(models.Approval.site_id.in_(site_ids))
            .order_by(desc(models.Approval.created_at))
        )
        for a in (await session.execute(a_stmt)).scalars().all():
            approval_by_site.setdefault(a.site_id, a)
        n_stmt = select(models.NsoReview).where(models.NsoReview.site_id.in_(site_ids))
        nso_rows = (await session.execute(n_stmt)).scalars().all()
        nso_by_site = {n.site_id: n for n in nso_rows}
        l_stmt = select(models.LaunchApproval).where(models.LaunchApproval.site_id.in_(site_ids))
        launch_rows = (await session.execute(l_stmt)).scalars().all()
        launch_by_site = {l.site_id: l for l in launch_rows}

    approver_ids = {a.approver_id for a in approval_by_site.values() if a.approver_id}
    names = {}
    user_ids = submitter_ids | assignee_ids | approver_ids
    if user_ids:
        u_stmt = select(models.User.id, models.User.name).where(models.User.id.in_(user_ids))
        names = {u_id: n for u_id, n in (await session.execute(u_stmt)).all()}

    items = [
        site_to_response(
            r,
            created_by_name=names.get(r.submitted_by, ""),
            assigned_to_name=names.get(r.assigned_to, "") if r.assigned_to else None,
            details=detail_by_site.get(r.id),
            project=project_by_site.get(r.id),
            approval=approval_by_site.get(r.id),
            approved_by_name=(
                names.get(approval_by_site[r.id].approver_id) if r.id in approval_by_site else None
            ),
            nso=nso_by_site.get(r.id),
            launch=launch_by_site.get(r.id),
        )
        for r in rows
    ]
    return SiteListResponse(items=items, total=len(items))


async def get_site(
    session: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID, user: dict,
) -> SiteResponse:
    site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
    # role scope re-check: an exec must not be able to read another exec's site
    from app.rbac.roles import Role

    if (
        user["role"] == Role.EXECUTIVE.value
        and str(site.submitted_by) != user["sub"]
        and str(site.assigned_to or "") != user["sub"]
    ):
        from fastapi import HTTPException, status as http_status
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Forbidden")

    name_stmt = select(models.User.name).where(models.User.id == site.submitted_by)
    name = (await session.execute(name_stmt)).scalar_one_or_none()
    assigned_to_name = None
    if site.assigned_to:
        assigned_name_stmt = select(models.User.name).where(models.User.id == site.assigned_to)
        assigned_to_name = (await session.execute(assigned_name_stmt)).scalar_one_or_none()
    detail_stmt = select(models.SiteDetail).where(models.SiteDetail.site_id == site.id)
    details = (await session.execute(detail_stmt)).scalar_one_or_none()
    project_stmt = select(models.ProjectReview).where(models.ProjectReview.site_id == site.id)
    project = (await session.execute(project_stmt)).scalar_one_or_none()
    # Latest approval → expected_loi_days + approver name for the SLA view (#115).
    approval_stmt = (
        select(models.Approval)
        .where(models.Approval.site_id == site.id)
        .order_by(desc(models.Approval.created_at))
        .limit(1)
    )
    approval = (await session.execute(approval_stmt)).scalar_one_or_none()
    approved_by_name = None
    if approval and approval.approver_id:
        approver_stmt = select(models.User.name).where(models.User.id == approval.approver_id)
        approved_by_name = (await session.execute(approver_stmt)).scalar_one_or_none()
    nso_stmt = select(models.NsoReview).where(models.NsoReview.site_id == site.id)
    nso = (await session.execute(nso_stmt)).scalar_one_or_none()
    launch_stmt = select(models.LaunchApproval).where(models.LaunchApproval.site_id == site.id)
    launch = (await session.execute(launch_stmt)).scalar_one_or_none()
    return site_to_response(
        site,
        created_by_name=name or "",
        assigned_to_name=assigned_to_name,
        details=details,
        project=project,
        approval=approval,
        approved_by_name=approved_by_name,
        nso=nso,
        launch=launch,
    )


_MODULE_AUDIT_FILTERS = {
    "legal": (
        ("eq", "send_to_legal"),
        ("prefix", "legal_"),
        ("prefix", "change_request_"),
    ),
    "design": (
        ("prefix", "design_"),
    ),
    "project": (
        ("prefix", "project_"),
    ),
    "nso": (
        ("prefix", "nso_"),
        ("eq", "project_pushed_to_nso"),
    ),
}


def _module_audit_clause(module: Optional[str]):
    rules = _MODULE_AUDIT_FILTERS.get((module or "").lower())
    if not rules:
        return None
    clauses = []
    for kind, value in rules:
        if kind == "eq":
            clauses.append(models.AuditLog.action == value)
        elif kind == "prefix":
            clauses.append(models.AuditLog.action.like(f"{value}%"))
    return or_(*clauses) if clauses else None


async def list_site_activity(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    site_id: str | UUID,
    limit: int = 100,
    module: Optional[str] = None,
) -> AuditListResponse:
    module_clause = _module_audit_clause(module)
    stmt = select(models.AuditLog).where(
        models.AuditLog.tenant_id == tenant_id,
        models.AuditLog.site_id == site_id,
    )
    if module_clause is not None:
        stmt = stmt.where(module_clause)
    stmt = stmt.order_by(desc(models.AuditLog.created_at)).limit(limit)
    rows = (await session.execute(stmt)).scalars().all()
    items = [_audit_to_event(r) for r in rows]
    return AuditListResponse(items=items, total=len(items))


async def list_tenant_audit(
    session: AsyncSession, *, tenant_id: str | UUID, page: int = 1, limit: int = 50,
) -> AuditListResponse:
    offset = max(0, (page - 1) * limit)
    stmt = (
        select(models.AuditLog)
        .where(models.AuditLog.tenant_id == tenant_id)
        .order_by(desc(models.AuditLog.created_at))
        .limit(limit).offset(offset)
    )
    rows = (await session.execute(stmt)).scalars().all()
    total = (await session.execute(
        select(func.count(models.AuditLog.id)).where(models.AuditLog.tenant_id == tenant_id)
    )).scalar_one()
    return AuditListResponse(items=[_audit_to_event(r) for r in rows], total=int(total))


def _audit_to_event(r: models.AuditLog) -> AuditEvent:
    return AuditEvent(
        id=str(r.id),
        site_id=str(r.site_id) if r.site_id else None,
        actor=r.actor_name or "system",
        action=r.action,
        from_status=r.from_status,
        to_status=r.to_status,
        detail=r.detail,
        field_name=r.field_name,
        from_value=r.from_value,
        to_value=r.to_value,
        created_at=r.created_at,
    )
