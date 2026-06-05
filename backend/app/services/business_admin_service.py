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
from typing import Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import transaction
from app.domain.schemas.business_admin import Module


_PENDING_MODULE_PREFIX = "pending_module:"
_VALID_MODULES: frozenset[str] = frozenset(("bd", "legal", "payment", "design", "project"))


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
        await session.execute(
            text("""
                INSERT INTO user_module_memberships
                       (user_id, tenant_id, module, role_in_module, supervisor_id)
                VALUES (CAST(:uid AS uuid), :tid, :module, 'supervisor', NULL)
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


# ── Finance / payment admin queue ────────────────────────────────────────────

async def list_finance_admin_queue(
    session: AsyncSession, tenant_id: str | UUID,
) -> dict:
    """Sites whose finance sub-workflow is parked at 'awaiting_admin' — i.e. the
    supervisor approved and it now needs the business_admin's final sign-off
    (POST /sites/{site_id}/finance/approve)."""
    rows = (await session.execute(
        text("""
            SELECT s.id AS site_id, s.code AS site_code, s.name AS site_name, s.city AS city,
                   s.ca_code AS ca_code, s.finance_amount AS finance_amount,
                   u.name AS submitted_by_name
              FROM sites s
              LEFT JOIN users u ON u.id = s.submitted_by
             WHERE s.tenant_id = :tid
               AND s.finance_status = 'awaiting_admin'
             ORDER BY s.name
        """),
        {"tid": tenant_id},
    )).mappings().all()
    return {
        "items": [
            {
                "site_id": str(r["site_id"]),
                "site_code": r["site_code"] or "",
                "site_name": r["site_name"],
                "city": r["city"],
                "ca_code": r["ca_code"],
                "finance_amount": float(r["finance_amount"]) if r["finance_amount"] is not None else None,
                "submitted_by_name": r["submitted_by_name"],
            }
            for r in rows
        ],
        "total": len(rows),
    }


# ── Department org tree (supervisors + the executives under them) ─────────────

# Departments shown in the org view. Payment is an approval sub-workflow, not a
# dept onboarded via a code, so it is intentionally omitted here.
_ORG_MODULES: tuple[str, ...] = ("bd", "legal", "design", "project")


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
