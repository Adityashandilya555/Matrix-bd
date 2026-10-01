"""Supervisor cross-module workspace access: request, decide, revoke.

A grant lets a supervisor of one module act as a supervisor of another. No
`user_module_memberships` row is ever written — the row in
`supervisor_module_access_grants` IS the grant, and `core/deps.py` probes it on
every authenticated request that carries an X-Override-Module header. The
migration header explains why a real membership row would be wrong (it would
silently relocate the supervisor at their next login).

Both sides of the flow live in one module: the supervisor's request and the
admin's decision are one table with one status vocabulary. The executive-access
precedent split them — raw SQL inline in routers/users.py for the request, the
queue and decisions in business_admin_service — which left the read and write
sides of one feature in different layers.
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import transaction
from app.services.audit_service import write_audit_event


# Mirrors domain/schemas/business_admin.py's Module literal and the CHECK on
# supervisor_module_access_grants.module. The page renders one row per module in
# this order.
_MODULES: tuple[str, ...] = (
    "bd", "legal", "design", "project", "nso", "project_excellence",
)


def _is_uuid(value: str) -> bool:
    """Whether a path-supplied id is even a UUID.

    The guarded UPDATEs below cast their id with `CAST(:id AS uuid)`, so a
    malformed one would reach the driver and surface as a 500 rather than the
    silent no-op that every other not-found takes here.
    """
    try:
        UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return False
    return True


# ── The supervisor's own side ────────────────────────────────────────────────

async def list_my_module_access(
    session: AsyncSession, *, supervisor_id: str, tenant_id: str, home_module: Optional[str],
) -> list[dict]:
    """One row per module, describing what this supervisor may do with it.

    Keyed on `home_module` — the JWT's OWN module, never the borrowed one — so
    the page reads the same whether or not the caller is currently inside
    someone else's workspace.
    """
    rows = (await session.execute(
        text(
            "SELECT module, status, created_at, decided_at "
            "  FROM supervisor_module_access_grants "
            " WHERE supervisor_id = :sid AND tenant_id = :tid "
            # The live row first, then the newest decision, then id as a
            # deterministic tiebreak — rows created in the same transaction
            # share a created_at, and without this an older rejected row could
            # sort ahead of a live one and mask it.
            " ORDER BY (status IN ('pending', 'approved')) DESC, "
            "          created_at DESC, id DESC"
        ),
        {"sid": supervisor_id, "tid": tenant_id},
    )).mappings().all()

    # Newest row per module wins: the live one if there is one (the partial
    # unique index allows at most a single pending-or-approved row), otherwise
    # the most recent decision.
    newest: dict[str, dict] = {}
    for row in rows:
        newest.setdefault(row["module"], dict(row))

    out: list[dict] = []
    for module in _MODULES:
        if module == home_module:
            out.append({
                "module": module, "state": "home", "last_decision": None,
                "requested_at": None, "decided_at": None,
            })
            continue
        row = newest.get(module)
        if row is None:
            state, last_decision = "none", None
        elif row["status"] == "approved":
            state, last_decision = "granted", None
        elif row["status"] == "pending":
            state, last_decision = "pending", None
        else:
            # rejected | revoked — requestable again, and the page says why it
            # is not granted.
            state, last_decision = "none", row["status"]
        out.append({
            "module": module,
            "state": state,
            "last_decision": last_decision,
            "requested_at": row["created_at"] if row else None,
            "decided_at": row["decided_at"] if row else None,
        })
    return out


async def request_module_access(
    session: AsyncSession, *,
    supervisor_id: str, tenant_id: str, home_module: Optional[str],
    module: str, actor_name: Optional[str] = None,
) -> None:
    """File a request for supervisor access to another module. Idempotent."""
    if module == home_module:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="You already supervise this module.",
        )
    async with transaction(session):
        granted = (await session.execute(
            text(
                "SELECT 1 FROM supervisor_module_access_grants "
                " WHERE supervisor_id = :sid AND tenant_id = :tid "
                "   AND module = :m AND status = 'approved'"
            ),
            {"sid": supervisor_id, "tid": tenant_id, "m": module},
        )).first()
        if granted:
            raise HTTPException(
                status_code=http_status.HTTP_409_CONFLICT,
                detail="You already have access to this module.",
            )
        row = (await session.execute(
            text(
                "INSERT INTO supervisor_module_access_grants "
                "(tenant_id, supervisor_id, module) "
                "VALUES (:tid, :sid, :m) "
                # The partial-index predicate has to be restated verbatim or
                # Postgres cannot infer uq_smag_supervisor_module_live — the
                # lesson from migration 20260818.
                "ON CONFLICT (supervisor_id, module) "
                "WHERE status IN ('pending', 'approved') DO NOTHING "
                "RETURNING id"
            ),
            {"tid": tenant_id, "sid": supervisor_id, "m": module},
        )).mappings().first()
        if row is None:
            # A pending request already exists. Idempotent, like every other
            # approval flow here — a double-click is not an error.
            return
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=None,
            actor_id=supervisor_id,
            actor_name=actor_name,
            action="module_access_requested",
            entity_type="supervisor_module_access_grant",
            entity_id=str(row["id"]),
            detail=f"module={module}",
        )


# ── The business admin's side ────────────────────────────────────────────────

async def list_pending_requests(session: AsyncSession, tenant_id: str) -> list[dict]:
    """Requests awaiting a decision, oldest first."""
    rows = (await session.execute(
        text(
            "SELECT g.id, g.supervisor_id, u.email, u.name, g.module, g.created_at, "
            "       (SELECT m.module FROM user_module_memberships m "
            "         WHERE m.user_id = g.supervisor_id AND m.tenant_id = g.tenant_id "
            "           AND m.role_in_module = 'supervisor' "
            "         ORDER BY m.module LIMIT 1) AS home_module "
            "  FROM supervisor_module_access_grants g "
            "  JOIN users u ON u.id = g.supervisor_id "
            " WHERE g.tenant_id = :tid AND g.status = 'pending' "
            " ORDER BY g.created_at ASC"
        ),
        {"tid": tenant_id},
    )).mappings().all()
    return [
        {
            "id": str(r["id"]),
            "supervisor_id": str(r["supervisor_id"]),
            "supervisor_email": r["email"],
            "supervisor_name": r["name"],
            "home_module": r["home_module"],
            "module": r["module"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]


async def _decide(
    session: AsyncSession, *,
    tenant_id: str, request_id: str, actor_id: str, actor_name: Optional[str],
    new_status: str, action: str, require_active_supervisor: bool = False,
) -> None:
    """Approve or reject, sharing the guarded UPDATE that makes both idempotent.

    The `AND status = 'pending'` in the WHERE *is* the idempotency: a replay, a
    wrong tenant and a missing row all come back empty and fall out at the same
    branch — the convention from business_admin_service.approve_executive_request.
    The audit write sits after it, so a replayed decision records nothing.

    A malformed id takes that same branch rather than reaching the cast.
    """
    if not _is_uuid(request_id):
        return
    # Only approval requires it. A rejection must stay possible whatever became
    # of the requester, or a demoted supervisor's row sits in the queue forever
    # with no way to clear it.
    still_a_supervisor = (
        "   AND EXISTS (SELECT 1 FROM users u "
        "                WHERE u.id = g.supervisor_id "
        "                  AND u.tenant_id = g.tenant_id "
        "                  AND u.role = 'supervisor' AND u.is_active) "
    ) if require_active_supervisor else ""
    async with transaction(session):
        row = (await session.execute(
            text(
                "UPDATE supervisor_module_access_grants AS g "
                "   SET status = :new_status, decided_at = now(), "
                "       decided_by = CAST(:aid AS uuid) "
                " WHERE g.id = CAST(:rid AS uuid) AND g.tenant_id = :tid "
                "   AND g.status = 'pending' "
                + still_a_supervisor
                + "RETURNING g.supervisor_id, g.module"
            ),
            {"aid": actor_id, "rid": request_id, "tid": tenant_id,
             "new_status": new_status},
        )).mappings().first()
        if not row:
            return
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=None,
            actor_id=actor_id,
            actor_name=actor_name,
            action=action,
            entity_type="supervisor_module_access_grant",
            entity_id=request_id,
            detail=f"module={row['module']} supervisor={row['supervisor_id']}",
        )


async def approve_request(
    session: AsyncSession, tenant_id: str, request_id: str,
    actor_id: str, actor_name: Optional[str] = None,
) -> None:
    """Grant the access. Writes no membership row — the grant is this row.

    Refuses if the requester is no longer an active supervisor. A queue is read
    at one moment and acted on at another, and without this an admin who demotes
    someone *because* of their request — then clears the queue — leaves an
    approved grant behind. It would be inert while they are an executive and
    live again the moment anyone re-promotes them, with no second approval.
    """
    await _decide(
        session, tenant_id=tenant_id, request_id=request_id, actor_id=actor_id,
        actor_name=actor_name, new_status="approved", action="module_access_approved",
        require_active_supervisor=True,
    )


async def reject_request(
    session: AsyncSession, tenant_id: str, request_id: str,
    actor_id: str, actor_name: Optional[str] = None,
) -> None:
    """Turn the request down. The row is kept so the refusal is on record."""
    await _decide(
        session, tenant_id=tenant_id, request_id=request_id, actor_id=actor_id,
        actor_name=actor_name, new_status="rejected", action="module_access_rejected",
    )


async def list_active_grants(session: AsyncSession, tenant_id: str) -> list[dict]:
    """Live grants, with the number of executives each borrower recruited.

    `recruited_count` exists because revoking does NOT remove those executives —
    they stay active and resurface under the module's unassigned list. The admin
    should see that before pressing Revoke, not after.
    """
    rows = (await session.execute(
        text(
            "SELECT g.id, g.supervisor_id, u.email, u.name, g.module, g.decided_at, "
            "       (SELECT count(*) FROM user_module_memberships m "
            "         WHERE m.tenant_id = g.tenant_id AND m.module = g.module "
            "           AND m.supervisor_id = g.supervisor_id "
            "           AND m.role_in_module = 'executive') AS recruited_count "
            "  FROM supervisor_module_access_grants g "
            "  JOIN users u ON u.id = g.supervisor_id "
            " WHERE g.tenant_id = :tid AND g.status = 'approved' "
            " ORDER BY u.name, g.module"
        ),
        {"tid": tenant_id},
    )).mappings().all()
    return [
        {
            "id": str(r["id"]),
            "supervisor_id": str(r["supervisor_id"]),
            "supervisor_email": r["email"],
            "supervisor_name": r["name"],
            "module": r["module"],
            "decided_at": r["decided_at"],
            "recruited_count": int(r["recruited_count"] or 0),
        }
        for r in rows
    ]


async def revoke_grant(
    session: AsyncSession, tenant_id: str, grant_id: str,
    actor_id: str, actor_name: Optional[str] = None,
) -> None:
    """Withdraw a live grant.

    Takes effect on the borrower's very next request — deps.py reads this table
    every time and nothing is cached in the token. Executives they recruited are
    deliberately left alone; deactivating active people as a side effect of an
    admin toggle would be worse than an orphaned link.

    A malformed id no-ops rather than reaching the cast.
    """
    if not _is_uuid(grant_id):
        return
    async with transaction(session):
        row = (await session.execute(
            text(
                "UPDATE supervisor_module_access_grants "
                "   SET status = 'revoked', revoked_at = now(), "
                "       revoked_by = CAST(:aid AS uuid) "
                " WHERE id = CAST(:gid AS uuid) AND tenant_id = :tid "
                "   AND status = 'approved' "
                "RETURNING supervisor_id, module"
            ),
            {"aid": actor_id, "gid": grant_id, "tid": tenant_id},
        )).mappings().first()
        if not row:
            return
        await write_audit_event(
            session,
            tenant_id=tenant_id,
            site_id=None,
            actor_id=actor_id,
            actor_name=actor_name,
            action="module_access_revoked",
            entity_type="supervisor_module_access_grant",
            entity_id=grant_id,
            detail=f"module={row['module']} supervisor={row['supervisor_id']}",
        )
