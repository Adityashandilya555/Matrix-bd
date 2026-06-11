"""Business-admin service: per-module dept codes + pending-supervisor approvals.

These endpoints power the /business-admin portal. The `module_codes` and
`user_module_memberships` tables live outside the SQLAlchemy ORM, so this
module talks to them via raw `text()` queries.

Pending supervisors are encoded in the existing `users` table as
`role='supervisor' AND is_active=false`. The module they applied for is
stashed in `users.notes` as the marker
`pending_module:<bd|legal|payment|design|project>`.
On approval we activate the user, drop the marker, and register the module
membership; on rejection we delete the row.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import desc, select, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.db.session import transaction
from app.domain.schemas.business_admin import Module
from app.services._common import fetch_user_name
from app.services.finance_service import svc_finance_approve, svc_finance_reject


_PENDING_MODULE_PREFIX = "pending_module:"
_VALID_MODULES: frozenset[str] = frozenset(("bd", "legal", "payment", "design", "project", "nso"))


def _new_dept_code() -> str:
    return secrets.token_urlsafe(8).upper()


def _parse_pending_module(notes: Optional[str]) -> Optional[str]:
    """Return the module a pending supervisor applied for, or None if the
    marker is missing/malformed."""
    if not notes or not notes.startswith(_PENDING_MODULE_PREFIX):
        return None
    candidate = notes[len(_PENDING_MODULE_PREFIX):].strip().lower()
    return candidate if candidate in _VALID_MODULES else None


async def list_dept_codes(session: AsyncSession, tenant_id: str | UUID) -> list[dict]:
    rows = (await session.execute(
        text("""
            SELECT id, module, code, created_at, rotated_at
              FROM module_codes
             WHERE tenant_id = :tid
             ORDER BY module
        """),
        {"tid": tenant_id},
    )).mappings().all()
    return [
        {
            "id": str(r["id"]),
            "module": r["module"],
            "code": r["code"],
            "created_at": r["created_at"],
            "rotated_at": r["rotated_at"],
        }
        for r in rows
    ]


async def rotate_dept_code(
    session: AsyncSession,
    tenant_id: str | UUID,
    module: Module,
    created_by: str | UUID,
) -> dict:
    async with transaction(session):
        row = (await session.execute(
            text("""
                INSERT INTO module_codes (tenant_id, module, code, created_by)
                VALUES (:tid, :module, :code, :uid)
                ON CONFLICT (tenant_id, module) DO UPDATE
                  SET code = EXCLUDED.code,
                      rotated_at = now(),
                      created_by = EXCLUDED.created_by
                RETURNING module, code
            """),
            {"tid": tenant_id, "module": module, "code": _new_dept_code(), "uid": created_by},
        )).mappings().one()
    return {"module": row["module"], "code": row["code"]}


async def list_pending_supervisors(
    session: AsyncSession,
    tenant_id: str | UUID,
    module: Optional[Module] = None,
) -> list[dict]:
    rows = (await session.execute(
        text("""
            SELECT id, email, notes, created_at
              FROM users
             WHERE tenant_id = :tid
               AND role = 'supervisor'
               AND is_active = false
             ORDER BY created_at
        """),
        {"tid": tenant_id},
    )).mappings().all()

    items: list[dict] = []
    for r in rows:
        parsed = _parse_pending_module(r["notes"])
        if parsed is None:
            continue
        if module is not None and parsed != module:
            continue
        items.append({
            "id": str(r["id"]),
            "email": r["email"],
            "module": parsed,
            "created_at": r["created_at"],
        })
    return items


async def approve_supervisor(
    session: AsyncSession,
    tenant_id: str | UUID,
    user_id: str | UUID,
    module: Module,
) -> None:
    async with transaction(session):
        # Only act on a genuinely PENDING candidate in this tenant. Without this
        # guard a re-submit (double-click) re-activates the row and tries to
        # inject a second membership — which the UNIQUE(user_id, module) then
        # rejects as an unhandled 500. Idempotent no-op instead. (#123)
        target = (await session.execute(
            text("SELECT is_active FROM users WHERE id = CAST(:uid AS uuid) AND tenant_id = :tid"),
            {"uid": user_id, "tid": tenant_id},
        )).mappings().first()
        if not target or target["is_active"]:
            return
        await session.execute(
            text("""
                UPDATE users
                   SET is_active = true,
                       notes = NULL
                 WHERE id = CAST(:uid AS uuid)
                   AND tenant_id = :tid
            """),
            {"uid": user_id, "tid": tenant_id},
        )
        # ON CONFLICT guards the residual race where two approvals slip past the
        # pending check concurrently.
        await session.execute(
            text("""
                INSERT INTO user_module_memberships
                       (user_id, tenant_id, module, role_in_module, supervisor_id)
                VALUES (CAST(:uid AS uuid), :tid, :module, 'supervisor', NULL)
                ON CONFLICT (user_id, module) DO NOTHING
            """),
            {"uid": user_id, "tid": tenant_id, "module": module},
        )


async def reject_supervisor(
    session: AsyncSession,
    tenant_id: str | UUID,
    user_id: str | UUID,
) -> None:
    async with transaction(session):
        await session.execute(
            text("""
                DELETE FROM users
                 WHERE id = CAST(:uid AS uuid)
                   AND tenant_id = :tid
                   AND is_active = false
            """),
            {"uid": user_id, "tid": tenant_id},
        )


async def list_finance_approvals(
    session: AsyncSession,
    tenant_id: str | UUID,
) -> list[dict]:
    rows = (await session.execute(
        select(models.Site)
        .where(
            models.Site.tenant_id == tenant_id,
            models.Site.finance_status == "awaiting_admin",
        )
        .order_by(models.Site.updated_at.asc())
    )).scalars().all()

    items: list[dict] = []
    now = datetime.now(timezone.utc)
    for site in rows:
        updated_at = site.updated_at or site.created_at or now
        try:
            finance_amount = (
                float(site.finance_amount)
                if site.finance_amount is not None
                else None
            )
        except (TypeError, ValueError):
            finance_amount = None
        items.append({
            "site_id": str(site.id),
            "site_code": site.ca_code or site.code or f"SITE-{str(site.id)[:8].upper()}",
            "site_name": site.name or "Unnamed site",
            "city": site.city or "Unknown city",
            "site_status": site.status or "pending",
            "submitted_by_name": await fetch_user_name(session, site.submitted_by),
            "ca_code": site.ca_code,
            "finance_amount": finance_amount,
            "kyc_verified": bool(site.kyc_verified),
            "finance_status": site.finance_status or "awaiting_admin",
            "updated_at": updated_at,
        })
    return items


async def list_admin_sites(
    session: AsyncSession,
    tenant_id: str | UUID,
    limit: int = 80,
) -> dict:
    try:
        safe_limit = int(limit)
    except (TypeError, ValueError):
        safe_limit = 80
    safe_limit = max(1, min(safe_limit, 200))
    rows = (await session.execute(
        select(models.Site)
        .where(models.Site.tenant_id == tenant_id)
        .order_by(desc(models.Site.updated_at))
        .limit(safe_limit)
    )).scalars().all()

    # Snapshot site fields before the optional Project join. If the deployed
    # database has not run the Project migration yet, Postgres aborts the
    # transaction and a rollback can expire ORM instances. Keeping primitive
    # values here lets the admin timeline remain available while Project is
    # treated as an empty optional source.
    site_rows = []
    user_ids = set()
    for site in rows:
        data = {
            "id": site.id,
            "submitted_by": site.submitted_by,
            "assigned_to": site.assigned_to,
            "supervisor_id": site.supervisor_id,
            "ca_code": site.ca_code,
            "code": site.code,
            "name": site.name,
            "city": site.city,
            "status": site.status,
            "legal_dd_status": site.legal_dd_status,
            "agreement_status": site.agreement_status,
            "licensing_status": site.licensing_status,
            "finance_status": site.finance_status,
            "design_status": site.design_status,
            "is_launched": site.is_launched,
            "launched_at": site.launched_at,
            "finance_amount": site.finance_amount,
            "kyc_verified": site.kyc_verified,
            "created_at": site.created_at,
            "updated_at": site.updated_at,
            "draft_submitted_at": site.draft_submitted_at,
            "shortlisted_at": site.shortlisted_at,
            "details_submitted_at": site.details_submitted_at,
            "approved_at": site.approved_at,
            "loi_uploaded_at": site.loi_uploaded_at,
            "legal_review_at": site.legal_review_at,
            "legal_approved_at": site.legal_approved_at,
            "legal_rejected_at": site.legal_rejected_at,
            "pushed_to_payments_at": site.pushed_to_payments_at,
            "design_approved_at": site.design_approved_at,
            "rejection_reason": site.rejection_reason,
        }
        site_rows.append(data)
        for key in ("submitted_by", "assigned_to", "supervisor_id"):
            if data[key]:
                user_ids.add(data[key])

    site_ids = [site["id"] for site in site_rows]
    project_by_site = {}
    nso_by_site = {}
    launch_by_site = {}
    if site_ids:
        try:
            project_rows = (await session.execute(
                select(models.ProjectReview).where(models.ProjectReview.site_id.in_(site_ids))
            )).scalars().all()
            project_by_site = {
                row.site_id: {
                    "project_status": row.project_status,
                    "current_stage": row.current_stage,
                    "budget_status": row.budget_status,
                    "project_completed_at": row.project_completed_at,
                }
                for row in project_rows
            }
        except SQLAlchemyError:
            await session.rollback()
            project_by_site = {}
        try:
            nso_rows = (await session.execute(
                select(models.NsoReview).where(models.NsoReview.site_id.in_(site_ids))
            )).scalars().all()
            nso_by_site = {
                row.site_id: {
                    "nso_status": row.nso_status,
                    "current_stage": row.current_stage,
                }
                for row in nso_rows
            }
        except SQLAlchemyError:
            await session.rollback()
            nso_by_site = {}
        try:
            launch_rows = (await session.execute(
                select(models.LaunchApproval).where(models.LaunchApproval.site_id.in_(site_ids))
            )).scalars().all()
            launch_by_site = {
                row.site_id: {
                    "status": row.status,
                    "launched_at": row.launched_at,
                }
                for row in launch_rows
            }
        except SQLAlchemyError:
            await session.rollback()
            launch_by_site = {}

    names: dict = {}
    if user_ids:
        pairs = (await session.execute(
            select(models.User.id, models.User.name).where(models.User.id.in_(user_ids))
        )).all()
        names = {uid: name for uid, name in pairs}

    items = []
    now = datetime.now(timezone.utc)
    for site in site_rows:
        project = project_by_site.get(site["id"], {})
        nso = nso_by_site.get(site["id"], {})
        launch = launch_by_site.get(site["id"], {})
        created_at = site["created_at"] or site["updated_at"] or now
        updated_at = site["updated_at"] or site["created_at"] or now
        try:
            finance_amount = (
                float(site["finance_amount"])
                if site["finance_amount"] is not None
                else None
            )
        except (TypeError, ValueError):
            finance_amount = None
        items.append({
            "site_id": str(site["id"]),
            "site_code": site["ca_code"] or site["code"] or f"SITE-{str(site['id'])[:8].upper()}",
            "site_name": site["name"] or "Unnamed site",
            "city": site["city"] or "Unknown city",
            "site_status": site["status"] or "pending",
            "submitted_by_name": names.get(site["submitted_by"]),
            "assigned_to_name": names.get(site["assigned_to"]) if site["assigned_to"] else None,
            "supervisor_name": names.get(site["supervisor_id"]) if site["supervisor_id"] else None,
            "legal_dd_status": site["legal_dd_status"],
            "agreement_status": site["agreement_status"],
            "licensing_status": site["licensing_status"],
            "finance_status": site["finance_status"] or "pending",
            "design_status": site["design_status"] or "pending",
            "project_status": project.get("project_status", "pending"),
            "project_current_stage": project.get("current_stage"),
            "project_budget_status": project.get("budget_status"),
            "project_completed_at": project.get("project_completed_at"),
            "nso_status": nso.get("nso_status"),
            "nso_current_stage": nso.get("current_stage"),
            "launch_status": launch.get("status"),
            "is_launched": bool(site["is_launched"]),
            "launched_at": site["launched_at"] or launch.get("launched_at"),
            "ca_code": site["ca_code"],
            "finance_amount": finance_amount,
            "kyc_verified": bool(site["kyc_verified"]),
            "created_at": created_at,
            "updated_at": updated_at,
            "draft_submitted_at": site["draft_submitted_at"],
            "shortlisted_at": site["shortlisted_at"],
            "details_submitted_at": site["details_submitted_at"],
            "approved_at": site["approved_at"],
            "loi_uploaded_at": site["loi_uploaded_at"],
            "legal_review_at": site["legal_review_at"],
            "legal_approved_at": site["legal_approved_at"],
            "legal_rejected_at": site["legal_rejected_at"],
            "pushed_to_payments_at": site["pushed_to_payments_at"],
            "design_approved_at": site["design_approved_at"],
            "rejection_reason": site["rejection_reason"],
        })
    return {"items": items, "total": len(items)}


async def approve_finance(
    session: AsyncSession,
    tenant_id: str | UUID,
    site_id: str | UUID,
    actor: dict,
) -> dict:
    return await svc_finance_approve(
        session,
        tenant_id=tenant_id,
        actor=actor,
        site_id=site_id,
    )


async def reject_finance(
    session: AsyncSession,
    tenant_id: str | UUID,
    site_id: str | UUID,
    actor: dict,
    reason: str | None = None,
) -> dict:
    return await svc_finance_reject(
        session,
        tenant_id=tenant_id,
        actor=actor,
        site_id=site_id,
        reason=reason,
    )


# ── Department org tree (supervisors + the executives under them) ─────────────

# Departments shown in the org view. Payment is an approval sub-workflow, not a
# dept onboarded via a code, so it is intentionally omitted here.
_ORG_MODULES: tuple[str, ...] = ("bd", "legal", "design", "project", "nso")


async def list_org(session: AsyncSession, tenant_id: str | UUID) -> dict:
    """Per-department code + the active supervisors and the executives reporting
    to each (from user_module_memberships.supervisor_id). Executives with no (or
    an unknown) supervisor land in `unassigned_executives`."""
    codes = {
        r["module"]: r["code"]
        for r in (await session.execute(
            text("SELECT module, code FROM module_codes WHERE tenant_id = :tid"),
            {"tid": tenant_id},
        )).mappings().all()
    }

    rows = (await session.execute(
        text("""
            SELECT umm.module AS module, umm.role_in_module AS role_in_module,
                   umm.supervisor_id AS supervisor_id, umm.joined_at AS joined_at,
                   u.id AS id, u.email AS email, u.name AS name
              FROM user_module_memberships umm
              JOIN users u ON u.id = umm.user_id
             WHERE umm.tenant_id = :tid
               AND u.is_active = true
             ORDER BY umm.role_in_module, u.name
        """),
        {"tid": tenant_id},
    )).mappings().all()

    sups_by_mod: dict[str, list[dict]] = {m: [] for m in _ORG_MODULES}
    execs_by_mod: dict[str, list[dict]] = {m: [] for m in _ORG_MODULES}
    for r in rows:
        mod = r["module"]
        if mod not in sups_by_mod:
            continue  # skip payment / any non-dept module
        person = {
            "id": str(r["id"]),
            "email": r["email"],
            "name": r["name"],
            "joined_at": r["joined_at"],
        }
        if r["role_in_module"] == "supervisor":
            sups_by_mod[mod].append({**person, "executives": []})
        else:
            execs_by_mod[mod].append({
                **person,
                "_supervisor_id": str(r["supervisor_id"]) if r["supervisor_id"] else None,
            })

    modules: list[dict] = []
    for m in _ORG_MODULES:
        supervisors = sups_by_mod[m]
        index = {s["id"]: s for s in supervisors}
        unassigned: list[dict] = []
        for e in execs_by_mod[m]:
            sid = e.pop("_supervisor_id")
            if sid and sid in index:
                index[sid]["executives"].append(e)
            else:
                unassigned.append(e)
        modules.append({
            "module": m,
            "code": codes.get(m),
            "supervisors": supervisors,
            "unassigned_executives": unassigned,
        })
    return {"modules": modules}
