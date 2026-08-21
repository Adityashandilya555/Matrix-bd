"""Per-supervisor invite codes + pending-executive approvals.

Each supervisor mints their own per-module invite code (`bd`, `legal`,
`payment`). Executives sign up with that code; they land as inactive users
whose `notes` column carries `pending_supervisor:<sid>|module:<m>`. The owning
supervisor then approves or rejects from /team.

Storage:
    - `supervisor_invite_codes` is keyed by (supervisor_id, module). Rotating
      regenerates `code` and stamps `rotated_at`.
    - Pending-exec discovery scans `users` rows with role='executive',
      is_active=false, and a matching notes marker. Approval clears `notes`,
      flips `is_active`, and inserts a `user_module_memberships` row.
"""
from __future__ import annotations

import secrets

from fastapi import HTTPException, status as http_status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import transaction


_PENDING_PREFIX = "pending_supervisor:"
_MODULE_MARKER = "|module:"


def _generate_code() -> str:
    return secrets.token_urlsafe(8).upper()


async def get_my_code(session: AsyncSession, supervisor_id: str, module: str) -> dict | None:
    """Return this supervisor's active invite code for the module, or None if none exists."""
    row = (await session.execute(
        text(
            "SELECT module, code, created_at, rotated_at "
            "FROM supervisor_invite_codes "
            "WHERE supervisor_id = :sid AND module = :m AND revoked_at IS NULL"
        ),
        {"sid": supervisor_id, "m": module},
    )).mappings().first()
    return dict(row) if row else None


async def rotate_my_code(
    session: AsyncSession, tenant_id: str, supervisor_id: str, module: str,
) -> dict:
    """Mint or regenerate this supervisor's invite code for the module and stamp rotated_at."""
    async with transaction(session):
        row = (await session.execute(
            text(
                "INSERT INTO supervisor_invite_codes (tenant_id, supervisor_id, module, code) "
                "VALUES (:tid, :sid, :m, :code) "
                "ON CONFLICT (supervisor_id, module) DO UPDATE "
                "SET code = EXCLUDED.code, rotated_at = now() "
                "RETURNING module, code, created_at, rotated_at"
            ),
            {"tid": tenant_id, "sid": supervisor_id, "m": module, "code": _generate_code()},
        )).mappings().first()
    return dict(row)


async def list_my_pending_execs(
    session: AsyncSession, supervisor_id: str, module: str,
) -> list[dict]:
    """List inactive executives awaiting this supervisor's approval in the module."""
    # The marker is the exact `notes` value at signup time, so we can equality-
    # match in SQL and skip a Python parse pass entirely.
    marker = f"{_PENDING_PREFIX}{supervisor_id}{_MODULE_MARKER}{module}"
    rows = (await session.execute(
        text(
            "SELECT id, email, created_at "
            "FROM users "
            "WHERE role = 'executive' AND is_active = false AND notes = :marker"
        ),
        {"marker": marker},
    )).mappings().all()
    return [
        {"id": str(r["id"]), "email": r["email"], "module": module, "created_at": r["created_at"]}
        for r in rows
    ]


async def approve_my_pending_exec(
    session: AsyncSession,
    tenant_id: str,
    supervisor_id: str,
    user_id: str,
    module: str,
) -> None:
    """Activate a pending executive and bind them to this supervisor, enforcing ownership."""
    # NSO is a supervisor-only module (canonical list:
    # business_admin_service._SUPERVISOR_ONLY_MODULES) — it has no executive role,
    # so refuse to activate one there even if a stray pending row exists.
    if module == "nso":
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="NSO is a supervisor-only module — it has no executive role.",
        )
    # Ownership re-check (#86): the approve path must enforce the same
    # `notes` marker the list query scopes by — otherwise any supervisor in
    # the tenant can activate ANY pending user and bind them under themself.
    marker = f"{_PENDING_PREFIX}{supervisor_id}{_MODULE_MARKER}{module}"
    not_found = HTTPException(
        status_code=http_status.HTTP_404_NOT_FOUND,
        detail="No pending executive with that id awaits your approval.",
    )
    async with transaction(session):
        target = (await session.execute(
            text("SELECT is_active, role, notes FROM users WHERE id = :uid AND tenant_id = :tid"),
            {"uid": user_id, "tid": tenant_id},
        )).mappings().first()
        if not target:
            raise not_found
        if target["is_active"]:
            # Double-click / replay (#123): stay idempotent, but ONLY when the
            # user is already this supervisor's member in this module.
            member = (await session.execute(
                text(
                    "SELECT 1 FROM user_module_memberships "
                    "WHERE user_id = :uid AND module = :m AND supervisor_id = :sid"
                ),
                {"uid": user_id, "m": module, "sid": supervisor_id},
            )).mappings().first()
            if member:
                return
            raise not_found
        if target["role"] != "executive" or target["notes"] != marker:
            raise not_found
        # Predicates repeated in the UPDATE so a concurrent approve/edit can't
        # widen the write beyond what we just verified.
        await session.execute(
            text(
                "UPDATE users SET is_active = true, notes = NULL "
                "WHERE id = :uid AND tenant_id = :tid "
                "  AND is_active = false AND role = 'executive' AND notes = :marker"
            ),
            {"uid": user_id, "tid": tenant_id, "marker": marker},
        )
        await session.execute(
            text(
                "INSERT INTO user_module_memberships "
                "(user_id, tenant_id, module, role_in_module, supervisor_id) "
                "VALUES (:uid, :tid, :module, 'executive', :sid) "
                # Partial-index inference needs the predicate restated. Targets
                # uq_umm_user_module_supervisor, so a SECOND supervisor for the
                # same executive inserts rather than being swallowed — that is
                # the multi-supervisor rule (migration 20260818).
                "ON CONFLICT (user_id, module, supervisor_id) "
                "WHERE supervisor_id IS NOT NULL DO NOTHING"
            ),
            {"uid": user_id, "tid": tenant_id, "module": module, "sid": supervisor_id},
        )


async def list_my_team(
    session: AsyncSession, current_user: dict, module: str,
) -> list[dict]:
    """Active executives bound to this supervisor in this module.
    Business admins simulating a supervisor see all active executives in the module."""
    if current_user.get("real_role") == "business_admin":
        rows = (await session.execute(
            text(
                "SELECT u.id, u.email, u.name, umm.joined_at "
                "FROM user_module_memberships umm "
                "JOIN users u ON u.id = umm.user_id "
                "WHERE umm.module = :m "
                "  AND umm.role_in_module = 'executive' "
                "  AND umm.tenant_id = :tid "
                "  AND u.is_active = true"
            ),
            {"m": module, "tid": current_user["tenant_id"]},
        )).mappings().all()
    else:
        rows = (await session.execute(
            text(
                "SELECT u.id, u.email, u.name, umm.joined_at "
                "FROM user_module_memberships umm "
                "JOIN users u ON u.id = umm.user_id "
                "WHERE umm.supervisor_id = :sid "
                "  AND umm.module = :m "
                "  AND umm.role_in_module = 'executive' "
                "  AND u.is_active = true"
            ),
            {"sid": current_user["sub"], "m": module},
        )).mappings().all()
    return [
        {
            "id": str(r["id"]),
            "email": r["email"],
            "name": r["name"],
            "module": module,
            "joined_at": r["joined_at"],
        }
        for r in rows
    ]


async def reject_my_pending_exec(
    session: AsyncSession, tenant_id: str, user_id: str, supervisor_id: str,
) -> None:
    """Delete a pending recruit, scoped to only this supervisor's own inactive executives."""
    # Ownership scope (same class as #86): only THIS supervisor's pending
    # recruits are deletable — previously any supervisor could delete any
    # inactive user in the tenant (other supervisors' recruits, pending
    # workspace joiners).
    marker_prefix = f"{_PENDING_PREFIX}{supervisor_id}{_MODULE_MARKER}%"
    async with transaction(session):
        await session.execute(
            text(
                "DELETE FROM users "
                "WHERE id = :uid AND tenant_id = :tid AND is_active = false "
                "  AND role = 'executive' AND notes LIKE :marker_prefix"
            ),
            {"uid": user_id, "tid": tenant_id, "marker_prefix": marker_prefix},
        )


# ── Sharing an executive between supervisors ────────────────────────────────
#
# An executive may report to several supervisors within one module (migration
# 20260818 split the old UNIQUE (user_id, module) into two partial indexes).
#
# The second link is made HERE, by the supervisor, rather than by the executive
# redeeming a second invite code. Redeeming again is blocked two layers up:
# _enqueue_signup 409s on an email that is already active, and
# approve_my_pending_exec refuses any active target. Adding from this side needs
# neither relaxed, so signup, codes and approval keep working exactly as they do
# for a brand-new executive joining their first supervisor.


async def _assert_supervises_module(
    session: AsyncSession, *, supervisor_id: str, module: str, tenant_id: str,
) -> None:
    """Refuse a caller who is not a supervisor OF THIS MODULE.

    require_role(SUPERVISOR) on the route proves the caller is a supervisor
    somewhere; it says nothing about which module. Without this a legal
    supervisor could rearrange the BD teams.
    """
    row = (await session.execute(
        text(
            "SELECT 1 FROM user_module_memberships "
            " WHERE user_id = :sid AND module = :m AND tenant_id = :tid "
            "   AND role_in_module = 'supervisor'"
        ),
        {"sid": supervisor_id, "m": module, "tid": tenant_id},
    )).first()
    if not row:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="You do not supervise this module.",
        )


async def list_available_executives(
    session: AsyncSession, current_user: dict, module: str,
) -> list[dict]:
    """Executives already in this module who are NOT yet on the caller's team.

    Deliberately scoped to existing module members. This endpoint adds a second
    supervisor to someone already inside the module — it is not a way to pull an
    executive across a module boundary, which is what require_module exists to
    hold.
    """
    tenant_id = current_user["tenant_id"]
    await _assert_supervises_module(
        session, supervisor_id=current_user["sub"], module=module, tenant_id=tenant_id,
    )
    rows = (await session.execute(
        text(
            "SELECT DISTINCT u.id, u.email, u.name "
            "  FROM user_module_memberships umm "
            "  JOIN users u ON u.id = umm.user_id "
            " WHERE umm.module = :m "
            "   AND umm.tenant_id = :tid "
            "   AND umm.role_in_module = 'executive' "
            "   AND u.is_active = true "
            "   AND NOT EXISTS ( "
            "         SELECT 1 FROM user_module_memberships mine "
            "          WHERE mine.user_id = umm.user_id "
            "            AND mine.module = :m "
            "            AND mine.supervisor_id = :sid) "
            " ORDER BY u.name"
        ),
        {"m": module, "tid": tenant_id, "sid": current_user["sub"]},
    )).mappings().all()
    return [
        {"id": str(r["id"]), "email": r["email"], "name": r["name"], "module": module}
        for r in rows
    ]


async def add_existing_executive(
    session: AsyncSession, current_user: dict, module: str, user_id: str,
) -> None:
    """Link an executive already in this module to the calling supervisor too.

    Idempotent: a repeat call hits the partial unique index and does nothing,
    rather than 409-ing a supervisor who double-clicked.
    """
    tenant_id = current_user["tenant_id"]
    supervisor_id = current_user["sub"]
    await _assert_supervises_module(
        session, supervisor_id=supervisor_id, module=module, tenant_id=tenant_id,
    )
    async with transaction(session):
        target = (await session.execute(
            text(
                "SELECT u.is_active, u.role, "
                "       EXISTS (SELECT 1 FROM user_module_memberships m "
                "                WHERE m.user_id = u.id AND m.module = :m "
                "                  AND m.tenant_id = :tid) AS in_module "
                "  FROM users u WHERE u.id = :uid AND u.tenant_id = :tid"
            ),
            {"uid": user_id, "m": module, "tid": tenant_id},
        )).mappings().first()
        if not target or not target["is_active"] or target["role"] != "executive":
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="Active executive not found in this workspace.",
            )
        if not target["in_module"]:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail=(
                    "That executive is not a member of this module. They must join "
                    "it with a supervisor's invite code first."
                ),
            )
        await session.execute(
            text(
                "INSERT INTO user_module_memberships "
                "(user_id, tenant_id, module, role_in_module, supervisor_id) "
                "VALUES (:uid, :tid, :m, 'executive', :sid) "
                "ON CONFLICT (user_id, module, supervisor_id) "
                "WHERE supervisor_id IS NOT NULL DO NOTHING"
            ),
            {"uid": user_id, "tid": tenant_id, "m": module, "sid": supervisor_id},
        )


async def remove_from_my_team(
    session: AsyncSession, current_user: dict, module: str, user_id: str,
) -> None:
    """Drop only the caller's own link to this executive.

    Never touches users.is_active, and never touches another supervisor's link —
    an executive shared with someone else keeps working for them. Deactivating an
    account that has run out of teams is the business admin's path
    (business_admin_service.unlink_or_deactivate), not this one.
    """
    tenant_id = current_user["tenant_id"]
    await _assert_supervises_module(
        session, supervisor_id=current_user["sub"], module=module, tenant_id=tenant_id,
    )
    async with transaction(session):
        await session.execute(
            text(
                "DELETE FROM user_module_memberships "
                " WHERE user_id = :uid AND tenant_id = :tid AND module = :m "
                "   AND supervisor_id = :sid AND role_in_module = 'executive'"
            ),
            {"uid": user_id, "tid": tenant_id, "m": module, "sid": current_user["sub"]},
        )
