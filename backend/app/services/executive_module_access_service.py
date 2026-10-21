"""Executive cross-module workspace access: request, cancel, decide, revoke.

The executive sibling of module_access_service. An executive of one module asks
a business admin for executive access to another, naming the supervisor of that
module they will report to. As there, no `user_module_memberships` row is ever
written — the row in `executive_module_access_grants` IS the grant, and it also
carries the reporting line (`target_supervisor_id`) that
supervisor_code_service.list_my_team reads. See migration 20261022 for why a
real membership row would be wrong.

Kept separate from module_access_service rather than parameterised over it: the
two tables differ in a column, a status, and a module list, and folding them
behind a flag would put a branch in every statement that is a guarded UPDATE
today.
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import TextClause, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import transaction
from app.services import notification_service
from app.services.audit_service import write_audit_event


# Mirrors the CHECK on executive_module_access_grants.module. NSO is absent on
# purpose: it is supervisor-only, so there is no executive identity to borrow.
_MODULES: tuple[str, ...] = (
    "bd", "legal", "design", "project", "project_excellence",
)

_ENTITY = "executive_module_access_grant"


# Both decisions share one guarded UPDATE, written out twice rather than
# assembled — the same convention as module_access_service. `AND status =
# 'pending'` is the idempotency.
_REJECT_GRANT_STMT = text(
    "UPDATE executive_module_access_grants AS g "
    "   SET status = :new_status, decided_at = now(), "
    "       decided_by = CAST(:aid AS uuid) "
    " WHERE g.id = CAST(:rid AS uuid) AND g.tenant_id = :tid "
    "   AND g.status = 'pending' "
    "RETURNING g.executive_id, g.module, g.target_supervisor_id"
)

# Approval also requires both people to still be who the request says: an active
# executive, and an active supervisor who still supervises the module. Rejection
# does not, so a stale row can always be cleared.
_APPROVE_GRANT_STMT = text(
    "UPDATE executive_module_access_grants AS g "
    "   SET status = :new_status, decided_at = now(), "
    "       decided_by = CAST(:aid AS uuid) "
    " WHERE g.id = CAST(:rid AS uuid) AND g.tenant_id = :tid "
    "   AND g.status = 'pending' "
    "   AND EXISTS (SELECT 1 FROM users u "
    "                WHERE u.id = g.executive_id "
    "                  AND u.tenant_id = g.tenant_id "
    "                  AND u.role = 'executive' AND u.is_active) "
    "   AND EXISTS (SELECT 1 FROM users s "
    "                JOIN user_module_memberships m ON m.user_id = s.id "
    "                WHERE s.id = g.target_supervisor_id "
    "                  AND s.tenant_id = g.tenant_id "
    "                  AND s.role = 'supervisor' AND s.is_active "
    "                  AND m.module = g.module "
    "                  AND m.role_in_module = 'supervisor') "
    "RETURNING g.executive_id, g.module, g.target_supervisor_id"
)

# Active supervisors of a module: the dropdown's source, and the request's check
# for one of them. A membership row, not a borrowed supervisor grant — an
# executive reports to the module's own supervisors. Two whole literals, like
# every statement here, rather than one fragment with a suffix appended.
_MODULE_SUPERVISORS_STMT = text(
    "SELECT DISTINCT u.id, u.name, u.email "
    "  FROM user_module_memberships m "
    "  JOIN users u ON u.id = m.user_id "
    " WHERE m.tenant_id = :tid AND m.module = :m "
    "   AND m.role_in_module = 'supervisor' "
    "   AND u.role = 'supervisor' AND u.is_active = true"
    " ORDER BY u.name"
)

_IS_MODULE_SUPERVISOR_STMT = text(
    "SELECT DISTINCT u.id, u.name, u.email "
    "  FROM user_module_memberships m "
    "  JOIN users u ON u.id = m.user_id "
    " WHERE m.tenant_id = :tid AND m.module = :m "
    "   AND m.role_in_module = 'supervisor' "
    "   AND u.role = 'supervisor' AND u.is_active = true"
    "   AND u.id = CAST(:sid AS uuid)"
)


def _is_uuid(value: object) -> bool:
    """Whether an id is even a UUID, so a malformed one no-ops instead of a 500."""
    try:
        UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return False
    return True


def _assert_target_module(module: str, home_module: Optional[str]) -> None:
    """Refuse the home module and anything without an executive role (NSO)."""
    if module not in _MODULES:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="This module has no executive role.",
        )
    if module == home_module:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="You are already an executive of this module.",
        )


async def _notify(
    session: AsyncSession, *, tenant_id: str, event: str,
    recipient_ids: list, subject: str, payload: dict,
) -> None:
    """In-app notification, written inside the caller's transaction."""
    if not recipient_ids:
        return
    await notification_service.enqueue(
        session, tenant_id=tenant_id, event=event, recipient_ids=recipient_ids,
        channels=("in_app",), subject=subject, payload=payload,
    )


# ── The executive's own side ─────────────────────────────────────────────────

async def list_my_access(
    session: AsyncSession, *, executive_id: str, tenant_id: str, home_module: Optional[str],
) -> list[dict]:
    """One row per executive-bearing module, describing what this executive may do.

    Keyed on `home_module`, never the borrowed module, so the panel reads the
    same from inside another workspace.
    """
    rows = (await session.execute(
        text(
            "SELECT g.id, g.module, g.status, g.created_at, g.decided_at, "
            "       g.target_supervisor_id, s.name AS supervisor_name "
            "  FROM executive_module_access_grants g "
            "  LEFT JOIN users s ON s.id = g.target_supervisor_id "
            " WHERE g.executive_id = :eid AND g.tenant_id = :tid "
            # Live row first, then newest, then id — see module_access_service.
            " ORDER BY (g.status IN ('pending', 'approved')) DESC, "
            "          g.created_at DESC, g.id DESC"
        ),
        {"eid": executive_id, "tid": tenant_id},
    )).mappings().all()

    newest: dict[str, dict] = {}
    for found in rows:
        newest.setdefault(found["module"], dict(found))

    out: list[dict] = []
    for module in _MODULES:
        row = None if module == home_module else newest.get(module)
        entry: dict = {
            "module": module, "state": "none", "last_decision": None,
            "request_id": None, "supervisor_id": None, "supervisor_name": None,
            "requested_at": None, "decided_at": None,
        }
        if module == home_module:
            entry["state"] = "home"
        elif row is not None:
            entry["requested_at"] = row["created_at"]
            entry["decided_at"] = row["decided_at"]
            if row["status"] in ("approved", "pending"):
                entry["state"] = "granted" if row["status"] == "approved" else "pending"
                # The id only for a live row: it is what Cancel posts.
                entry["request_id"] = str(row["id"])
                sid = row["target_supervisor_id"]
                entry["supervisor_id"] = str(sid) if sid else None
                entry["supervisor_name"] = row["supervisor_name"]
            else:
                # rejected | revoked | cancelled — requestable again.
                entry["last_decision"] = row["status"]
        out.append(entry)
    return out


async def list_module_supervisors(
    session: AsyncSession, *, tenant_id: str, module: str, home_module: Optional[str],
) -> list[dict]:
    """The supervisors an executive may choose to work under in `module`."""
    _assert_target_module(module, home_module)
    rows = (await session.execute(
        _MODULE_SUPERVISORS_STMT,
        {"tid": tenant_id, "m": module},
    )).mappings().all()
    return [
        {"id": str(r["id"]), "name": r["name"], "email": r["email"]}
        for r in rows
    ]


async def request_access(
    session: AsyncSession, *,
    executive_id: str, tenant_id: str, home_module: Optional[str],
    module: str, target_supervisor_id: str,
    note: Optional[str] = None, actor_name: Optional[str] = None,
) -> None:
    """File a request for executive access to `module` under a chosen supervisor.

    A live row for the module — pending or approved — is a 409, not the silent
    no-op module_access_service uses: here the supervisor may differ, and
    keeping the old row quietly would ignore what the executive just chose.
    """
    _assert_target_module(module, home_module)
    if not _is_uuid(target_supervisor_id):
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Choose a supervisor of that module.",
        )
    async with transaction(session):
        supervises = (await session.execute(
            _IS_MODULE_SUPERVISOR_STMT,
            {"tid": tenant_id, "m": module, "sid": target_supervisor_id},
        )).first()
        if not supervises:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Choose a supervisor of that module.",
            )
        row = (await session.execute(
            text(
                "INSERT INTO executive_module_access_grants "
                "(tenant_id, executive_id, module, target_supervisor_id, note) "
                "VALUES (:tid, :eid, :m, CAST(:sid AS uuid), :note) "
                # The partial-index predicate restated verbatim so Postgres can
                # infer uq_emag_executive_module_live (the 20260818 lesson).
                "ON CONFLICT (executive_id, module) "
                "WHERE status IN ('pending', 'approved') DO NOTHING "
                "RETURNING id"
            ),
            {"tid": tenant_id, "eid": executive_id, "m": module,
             "sid": target_supervisor_id, "note": note},
        )).mappings().first()
        if row is None:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail="You already have a request or access for this module.",
            )
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=None,
            actor_id=executive_id,
            actor_name=actor_name,
            action="executive_module_access_requested",
            entity_type=_ENTITY,
            entity_id=str(row["id"]),
            detail=f"module={module} supervisor={target_supervisor_id}",
        )
        await _notify(
            session, tenant_id=tenant_id,
            event="executive_module_access_requested",
            recipient_ids=await notification_service.recipients_for_business_admins(
                session, tenant_id=tenant_id,
            ),
            subject=f"{actor_name or 'An executive'} requested {module} access",
            payload={"request_id": str(row["id"]), "module": module,
                     "executive_id": executive_id},
        )


async def cancel_my_request(
    session: AsyncSession, *, executive_id: str, tenant_id: str, request_id: str,
    actor_name: Optional[str] = None,
) -> None:
    """Withdraw one's own pending request. Anyone else's, or a decided one, no-ops."""
    if not _is_uuid(request_id):
        return
    async with transaction(session):
        row = (await session.execute(
            text(
                "UPDATE executive_module_access_grants "
                "   SET status = 'cancelled', decided_at = now() "
                " WHERE id = CAST(:rid AS uuid) AND tenant_id = :tid "
                "   AND executive_id = :eid AND status = 'pending' "
                "RETURNING module"
            ),
            {"rid": request_id, "tid": tenant_id, "eid": executive_id},
        )).mappings().first()
        if not row:
            return
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=None,
            actor_id=executive_id,
            actor_name=actor_name,
            action="executive_module_access_cancelled",
            entity_type=_ENTITY,
            entity_id=request_id,
            detail=f"module={row['module']}",
        )


# ── The business admin's side ────────────────────────────────────────────────

# The admin's two lists: pending requests oldest first, live grants by person.
# Whole literals; :st is bound, never interpolated.
_ADMIN_REQUESTS_STMT = text(
    "SELECT g.id, g.executive_id, u.email, u.name, g.module, g.note, "
    "       g.created_at, g.decided_at, "
    "       g.target_supervisor_id, s.name AS supervisor_name, "
    "       (SELECT m.module FROM user_module_memberships m "
    "         WHERE m.user_id = g.executive_id AND m.tenant_id = g.tenant_id "
    "           AND m.role_in_module = 'executive' "
    "         ORDER BY m.module LIMIT 1) AS home_module "
    "  FROM executive_module_access_grants g "
    "  JOIN users u ON u.id = g.executive_id "
    "  LEFT JOIN users s ON s.id = g.target_supervisor_id "
    " WHERE g.tenant_id = :tid AND g.status = :st "
    " ORDER BY g.created_at ASC"
)

_ADMIN_GRANTS_STMT = text(
    "SELECT g.id, g.executive_id, u.email, u.name, g.module, g.note, "
    "       g.created_at, g.decided_at, "
    "       g.target_supervisor_id, s.name AS supervisor_name, "
    "       (SELECT m.module FROM user_module_memberships m "
    "         WHERE m.user_id = g.executive_id AND m.tenant_id = g.tenant_id "
    "           AND m.role_in_module = 'executive' "
    "         ORDER BY m.module LIMIT 1) AS home_module "
    "  FROM executive_module_access_grants g "
    "  JOIN users u ON u.id = g.executive_id "
    "  LEFT JOIN users s ON s.id = g.target_supervisor_id "
    " WHERE g.tenant_id = :tid AND g.status = :st "
    " ORDER BY u.name, g.module"
)


def _admin_row(r) -> dict:
    """Shape one admin-list row; shared by the request and grant lists."""
    return {
        "id": str(r["id"]),
        "executive_id": str(r["executive_id"]),
        "executive_email": r["email"],
        "executive_name": r["name"],
        "home_module": r["home_module"],
        "module": r["module"],
        "supervisor_id": str(r["target_supervisor_id"]) if r["target_supervisor_id"] else None,
        "supervisor_name": r["supervisor_name"],
        "note": r["note"],
        "created_at": r["created_at"],
        "decided_at": r["decided_at"],
    }


async def list_pending_requests(session: AsyncSession, tenant_id: str) -> list[dict]:
    """Requests awaiting a decision, oldest first."""
    rows = (await session.execute(
        _ADMIN_REQUESTS_STMT,
        {"tid": tenant_id, "st": "pending"},
    )).mappings().all()
    return [_admin_row(r) for r in rows]


async def list_active_grants(session: AsyncSession, tenant_id: str) -> list[dict]:
    """Live grants, by executive then module."""
    rows = (await session.execute(
        _ADMIN_GRANTS_STMT,
        {"tid": tenant_id, "st": "approved"},
    )).mappings().all()
    return [_admin_row(r) for r in rows]


async def _decide(
    session: AsyncSession, *,
    tenant_id: str, request_id: str, actor_id: str, actor_name: Optional[str],
    new_status: str, action: str, stmt: TextClause,
) -> None:
    """Approve or reject through the guarded UPDATE, then audit and notify.

    The requester is told either way; the chosen supervisor only on approval,
    since a rejected request never reached their team.
    """
    if not _is_uuid(request_id):
        return
    async with transaction(session):
        row = (await session.execute(
            stmt,
            {"aid": actor_id, "rid": request_id, "tid": tenant_id,
             "new_status": new_status},
        )).mappings().first()
        if not row:
            return
        module = row["module"]
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=None,
            actor_id=actor_id,
            actor_name=actor_name,
            action=action,
            entity_type=_ENTITY,
            entity_id=request_id,
            detail=f"module={module} executive={row['executive_id']}",
        )
        payload = {"request_id": request_id, "module": module,
                   "executive_id": str(row["executive_id"])}
        await _notify(
            session, tenant_id=tenant_id, event=action,
            recipient_ids=[row["executive_id"]],
            subject=f"Your {module} access request was {new_status}",
            payload=payload,
        )
        if new_status == "approved" and row["target_supervisor_id"]:
            await _notify(
                session, tenant_id=tenant_id,
                event="executive_module_access_joined_team",
                recipient_ids=[row["target_supervisor_id"]],
                subject=f"An executive joined your {module} team",
                payload=payload,
            )


async def approve_request(
    session: AsyncSession, tenant_id: str, request_id: str,
    actor_id: str, actor_name: Optional[str] = None,
) -> None:
    """Grant the access. Refused (no-op) if either person is no longer eligible."""
    await _decide(
        session, tenant_id=tenant_id, request_id=request_id, actor_id=actor_id,
        actor_name=actor_name, new_status="approved",
        action="executive_module_access_approved", stmt=_APPROVE_GRANT_STMT,
    )


async def reject_request(
    session: AsyncSession, tenant_id: str, request_id: str,
    actor_id: str, actor_name: Optional[str] = None,
) -> None:
    """Turn the request down. The row is kept so the refusal is on record."""
    await _decide(
        session, tenant_id=tenant_id, request_id=request_id, actor_id=actor_id,
        actor_name=actor_name, new_status="rejected",
        action="executive_module_access_rejected", stmt=_REJECT_GRANT_STMT,
    )


async def revoke_grant(
    session: AsyncSession, tenant_id: str, grant_id: str,
    actor_id: str, actor_name: Optional[str] = None,
) -> None:
    """Withdraw a live grant and the executive's site delegations in that module.

    Unlike the supervisor grant, the people affected here are the executive's own
    delegations, and leaving them would leave sites assigned to someone who can
    no longer open them. Revoking them in the same transaction hands the sites
    back to the supervisor's queue.
    """
    if not _is_uuid(grant_id):
        return
    async with transaction(session):
        row = (await session.execute(
            text(
                "UPDATE executive_module_access_grants "
                "   SET status = 'revoked', revoked_at = now(), "
                "       revoked_by = CAST(:aid AS uuid) "
                " WHERE id = CAST(:gid AS uuid) AND tenant_id = :tid "
                "   AND status = 'approved' "
                "RETURNING executive_id, module"
            ),
            {"aid": actor_id, "gid": grant_id, "tid": tenant_id},
        )).mappings().first()
        if not row:
            return
        await session.execute(
            text(
                "UPDATE site_delegations "
                "   SET revoked_at = now(), revoked_by = CAST(:aid AS uuid) "
                " WHERE tenant_id = :tid AND delegate_user_id = :eid "
                "   AND module = :m AND revoked_at IS NULL"
            ),
            {"aid": actor_id, "tid": tenant_id, "eid": row["executive_id"],
             "m": row["module"]},
        )
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=None,
            actor_id=actor_id,
            actor_name=actor_name,
            action="executive_module_access_revoked",
            entity_type=_ENTITY,
            entity_id=grant_id,
            detail=f"module={row['module']} executive={row['executive_id']}",
        )
        await _notify(
            session, tenant_id=tenant_id, event="executive_module_access_revoked",
            recipient_ids=[row["executive_id"]],
            subject=f"Your {row['module']} access was withdrawn",
            payload={"grant_id": grant_id, "module": row["module"]},
        )
