"""Tenancy service — data-access + provisioning flows for the tenancy router.

The router (`app/routers/tenancy.py`) must stay thin: it validates payloads,
enforces the platform-admin guard, and shapes responses. Everything that builds
SQL or runs a multi-step provisioning flow lives here, so the tenant-scoping and
case-folding contracts live in one place instead of being re-implemented per
route handler (#378).

Note: several functions commit their own transaction — they mirror the
autocommit-per-route pattern the router used before the extraction, so behaviour
is unchanged. HTTPException is raised here (as `query_service.get_site` already
does) so the router can delegate the whole flow.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import secrets
import uuid
from typing import Any, Mapping, Optional

from fastapi import HTTPException, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.passwords import hash_password_async
from app.db import models
from app.services.auth_repo import get_tenant_by_workspace_code

logger = logging.getLogger("matrix.tenancy")

_DEFAULT_SEATS = 10


# ── Workspace-code / seat helpers ──────────────────────────────────────────

def _parse_seat_limit(team_size: Optional[str]) -> int:
    """Parse the team_size dropdown into an integer seat cap.

    Accepts strings like "1 to 10 users", "11 to 50 users", "51 to 200 users",
    "200+ users". Picks the upper bound (so "1 to 10" → 10). Falls back to
    _DEFAULT_SEATS if the string is missing or unparseable.
    """
    if not team_size:
        return _DEFAULT_SEATS
    s = team_size.strip().lower()
    # "200+ users" → 500 (generous cap, can be bumped by admin)
    if "+" in s:
        return 500
    nums = [int(n) for n in re.findall(r"\d+", s)]
    if not nums:
        return _DEFAULT_SEATS
    return max(nums)


def _generate_workspace_code(slug_hint: Optional[str] = None) -> str:
    """Generate a human-shareable workspace code.

    Format: <SLUGFRAG>-<RAND16>. The prefix is derived from the company name
    (guessable for a targeted org), so the random suffix carries ALL the
    secret material — token_hex(8) = 64 bits (#84; the old token_hex(2) gave
    only 65,536 possibilities). Collisions are improbable but the insert path
    retries on a unique-violation just in case.
    """
    base = re.sub(r"[^A-Za-z0-9]", "", (slug_hint or ""))[:6].upper()
    if not base:
        base = secrets.token_hex(3).upper()
    return f"{base}-{secrets.token_hex(8).upper()}"


# ── Simple reads ───────────────────────────────────────────────────────────

async def list_tenants(db: AsyncSession, tenant_id: Any) -> list[models.Tenant]:
    """The caller's own tenant row(s) (scoped to their tenant_id)."""
    stmt = select(models.Tenant).where(models.Tenant.id == tenant_id)
    return list((await db.execute(stmt)).scalars().all())


async def list_cities(db: AsyncSession, tenant_id: Any, *, limit: int) -> list[str]:
    """Distinct, ordered, bounded (#95) city names in the tenant."""
    stmt = (
        select(models.Site.city)
        .where(models.Site.tenant_id == tenant_id)
        .distinct()
        .order_by(models.Site.city)
        .limit(limit)
    )
    return [r for (r,) in (await db.execute(stmt)).all()]


async def get_workspace_info(db: AsyncSession, tenant_id: Any) -> Optional[Mapping[str, Any]]:
    """Tenant code + seat usage (used/pending) for the supervisor's own tenant."""
    return (await db.execute(
        text("""
            SELECT t.id, t.name, t.slug, t.plan, t.workspace_code, t.seat_limit,
                   (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS used_seats,
                   (SELECT COUNT(*) FROM users u
                      WHERE u.tenant_id = t.id AND u.is_active = false) AS pending_seats
              FROM tenants t WHERE t.id = :tid
        """),
        {"tid": tenant_id},
    )).mappings().first()


async def list_workspace_requests(
    db: AsyncSession, *, status_filter: Optional[str], limit: int,
) -> list[Mapping[str, Any]]:
    """Workspace requests for the admin portal (pending by default)."""
    # Two static statements instead of an f-string {where} splice (#82/F6):
    # the old pattern was safe today (fixed literal + bound param) but invited
    # a future edit to interpolate user input into established f-string SQL.
    base_select = """
        SELECT id, company, admin_email, team_size, seat_limit, status,
               created_at, decided_at, source_ip::text AS source_ip
          FROM workspace_requests
    """
    if status_filter and status_filter != "all":
        stmt = text(base_select + " WHERE status = :status ORDER BY created_at DESC LIMIT :lim")
        params: dict = {"lim": limit, "status": status_filter}
    else:
        stmt = text(base_select + " ORDER BY created_at DESC LIMIT :lim")
        params = {"lim": limit}
    return list((await db.execute(stmt, params)).mappings().all())


async def list_pending_password_reset_requests(db: AsyncSession) -> list[Mapping[str, Any]]:
    """Pending password-reset requests joined to their tenant, oldest first."""
    return list((await db.execute(
        text("""
            SELECT r.id, r.email, r.status, r.created_at,
                   t.name AS tenant_name, t.workspace_code
              FROM password_reset_requests r
              JOIN tenants t ON t.id = r.tenant_id
             WHERE r.status = 'pending'
             ORDER BY r.created_at ASC
        """),
    )).mappings().all())


# ── Public capture: workspace request ──────────────────────────────────────

async def insert_workspace_request(
    db: AsyncSession, *, company: str, admin_email: str,
    team_size: Optional[str], seat_limit: int, source_ip: Optional[str],
) -> Any:
    """Insert a workspace-creation request and return its id (commits)."""
    result = await db.execute(
        text(
            """
            INSERT INTO workspace_requests
                (company, admin_email, team_size, seat_limit, source_ip)
            VALUES
                (:company, :admin_email, :team_size, :seat_limit,
                 CAST(:source_ip AS inet))
            RETURNING id
            """
        ),
        {
            "company":     company,
            "admin_email": admin_email,
            "team_size":   team_size,
            "seat_limit":  seat_limit,
            "source_ip":   source_ip,
        },
    )
    row_id = result.scalar_one()
    await db.commit()
    return row_id


# ── Platform-admin reject ──────────────────────────────────────────────────

async def reject_workspace_request(db: AsyncSession, request_id: str) -> None:
    """Flip a pending request to 'rejected' (locked; 404/409 on bad state)."""
    req_row = (await db.execute(
        text("""
            SELECT id, status
              FROM workspace_requests
             WHERE id = :rid
             FOR UPDATE
        """),
        {"rid": request_id},
    )).mappings().first()
    if not req_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace request not found.")
    if req_row["status"] != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Request already {req_row['status']}.",
        )

    await db.execute(
        text("""
            UPDATE workspace_requests
               SET status='rejected',
                   decided_at=now()
             WHERE id=:rid
        """),
        {"rid": request_id},
    )
    await db.commit()


# ── Platform-admin approve ─────────────────────────────────────────────────

async def _create_tenant_with_retry(db, company: str, seat_limit: int, request_id: str):
    """Try up to 5 times to INSERT a tenant, re-rolling slug + workspace_code
    on unique-constraint collisions.  Extracted from approve_workspace_request
    to keep its cyclomatic complexity below the PY-R1000 threshold."""
    slug_base = re.sub(r"[^a-z0-9]+", "-", company.lower()).strip("-") or "tenant"
    last_error: Optional[str] = None
    for attempt in range(5):
        slug_try = slug_base if attempt == 0 else f"{slug_base}-{secrets.token_hex(2)}"
        ws_code  = _generate_workspace_code(slug_try)
        try:
            inserted = await db.execute(
                text("""
                    INSERT INTO tenants (slug, name, plan, seat_limit, workspace_code)
                    VALUES (:slug, :name, 'standard', :seat_limit, :code)
                    RETURNING id, workspace_code, seat_limit
                """),
                {
                    "slug":       slug_try,
                    "name":       company,
                    "seat_limit": seat_limit,
                    "code":       ws_code,
                },
            )
            return inserted.mappings().one()
        except Exception as e:  # noqa: BLE001
            msg = str(e).lower()
            last_error = msg[:240]
            logger.warning(
                "approve: tenant insert attempt %d failed slug=%r code=%r err=%s",
                attempt, slug_try, ws_code, last_error,
            )
            if "duplicate" in msg or "unique" in msg or "already exists" in msg:
                await db.rollback()
                still = (await db.execute(
                    text("SELECT status FROM workspace_requests WHERE id=:rid FOR UPDATE"),
                    {"rid": request_id},
                )).mappings().first()
                if not still or still["status"] != "pending":
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail="Concurrent approve detected.",
                    )
                continue
            raise
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"Could not create tenant after 5 attempts. Last error: {last_error}",
    )


async def approve_workspace_request(
    db: AsyncSession, *, request_id: str, admin_name: Optional[str], city: Optional[str],
) -> dict:
    """Provision a tenant + business_admin from a pending request (locked).

    Returns the provisioning result (tenant/workspace/admin ids + one-time setup
    token + company/email for the caller's response message). Raises 404/409 on
    a missing/already-decided request.
    """
    # 1. Load the request row + lock it for the duration of the txn so two
    #    admins clicking approve concurrently can't double-provision.
    req_row = (await db.execute(
        text("""
            SELECT id, company, admin_email, team_size, seat_limit, status
              FROM workspace_requests
             WHERE id = :rid
             FOR UPDATE
        """),
        {"rid": request_id},
    )).mappings().first()
    if not req_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace request not found.")
    if req_row["status"] != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Request already {req_row['status']}.",
        )

    # Cache the fields we'll need after retries — the rollback path drops the
    # row's mapping, and we don't want to re-SELECT each time.
    req_company     = req_row["company"]
    req_admin_email = req_row["admin_email"]
    req_seat_limit  = req_row["seat_limit"]

    # 2. Create the tenant. Both `slug` and `workspace_code` have unique
    #    constraints, so the retry path MUST mutate both — earlier versions
    #    only re-rolled the workspace_code and got stuck in an infinite slug
    #    collision when an existing tenant shared the company-derived slug
    #    (e.g. Shrey's seed data).
    tenant_row = await _create_tenant_with_retry(
        db, req_company, req_seat_limit, request_id,
    )

    tenant_id      = tenant_row["id"]
    workspace_code = tenant_row["workspace_code"]
    seat_limit     = tenant_row["seat_limit"]

    # 3. Insert the business_admin row directly into public.users. No Supabase
    #    Auth dance — the user will sign in with their email + the workspace
    #    code (which the platform admin shares with them out-of-band).
    business_admin_id = uuid.uuid4()
    await db.execute(
        text("""
            INSERT INTO users (id, tenant_id, role, email, name, is_active)
            VALUES (:id, :tenant_id, 'business_admin', :email, :name, true)
            ON CONFLICT (id) DO UPDATE
              SET tenant_id = EXCLUDED.tenant_id,
                  role      = 'business_admin',
                  is_active = true
        """),
        {
            "id":        business_admin_id,
            "tenant_id": tenant_id,
            "email":     req_admin_email,
            "name":      admin_name or req_admin_email.split("@")[0],
        },
    )

    # 3b. The admin ships with NO password and cannot log in until one is set
    #     (#83 closed the passwordless fall-through). Seed a pre-approved,
    #     token-bound reset request so they can set their first password via
    #     /auth/password-reset/complete; the platform admin relays the token
    #     out-of-band together with the workspace code.
    admin_setup_token = secrets.token_urlsafe(24)
    await db.execute(
        text("""
            INSERT INTO password_reset_requests
                (tenant_id, user_id, email, status, approved_at,
                 reset_token_hash, token_expires_at)
            VALUES
                (:tid, :uid, :email, 'approved', now(),
                 :th, now() + interval '30 days')
        """),
        {
            "tid": tenant_id,
            "uid": business_admin_id,
            "email": req_admin_email,
            "th": hashlib.sha256(admin_setup_token.encode()).hexdigest(),
        },
    )

    # 4. Marker row in business_admins. Confers tenant-wide admin scope; no
    #    user_module_memberships are seeded (business_admin is not a module member).
    await db.execute(
        text("""
            INSERT INTO business_admins (user_id, tenant_id, promoted_at)
            VALUES (:user_id, :tenant_id, now())
        """),
        {"user_id": business_admin_id, "tenant_id": tenant_id},
    )

    # 5. Mark the request approved.
    await db.execute(
        text("""
            UPDATE workspace_requests
               SET status='approved',
                   decided_at=now(),
                   provisioned_tenant_id=:tid
             WHERE id=:rid
        """),
        {"tid": tenant_id, "rid": request_id},
    )

    # 6. Enqueue a "workspace_provisioned" outbox row. The email worker drains
    #    notification_outbox and ships the credentials email out-of-band; the
    #    workspace_code travels in the payload (NOT the body) so a future
    #    template change can re-render without re-issuing the secret. This is
    #    the only place workspace_code appears outside the tenants table.
    outbox_subject = f"Your {req_company} workspace is ready — sign into the admin portal"
    outbox_body = (
        f"Hi {admin_name or req_admin_email.split('@')[0]},\n\n"
        f"Your workspace '{req_company}' has been provisioned. "
        f"Sign in at /business-admin with your workspace code to manage your team.\n\n"
        f"  Email: {req_admin_email}\n"
        f"  Workspace code: {workspace_code}\n\n"
        f"Seats: {seat_limit}. Add team members by sharing the workspace code "
        f"and assigning roles from /team.\n"
    )
    await db.execute(
        text("""
            INSERT INTO notification_outbox
                (tenant_id, type, channel, status, recipient_email,
                 subject, body, payload)
            VALUES
                (:tid, 'workspace_provisioned', 'email', 'pending', :email,
                 :subject, :body, CAST(:payload AS jsonb))
        """),
        {
            "tid":     tenant_id,
            "email":   req_admin_email,
            "subject": outbox_subject,
            "body":    outbox_body,
            # Serialise with json.dumps rather than hand-splicing the JSON
            # template (#240/18.5): a company/city containing a quote, backslash
            # or other escapable char produced malformed JSON, and
            # CAST(:payload AS jsonb) then threw at runtime. json.dumps escapes
            # every field correctly in all cases.
            "payload": json.dumps({
                "tenant_id": str(tenant_id),
                "workspace_code": workspace_code,
                "business_admin_id": str(business_admin_id),
                "supervisor_id": str(business_admin_id),
                "company": req_company,
                "city": city or "",
            }),
        },
    )

    await db.commit()

    return {
        "tenant_id":         tenant_id,
        "workspace_code":    workspace_code,
        "seat_limit":        seat_limit,
        "business_admin_id": business_admin_id,
        "admin_setup_token": admin_setup_token,
        "company":           req_company,
        "admin_email":       req_admin_email,
    }


# ── Public join: employee self-enrollment ──────────────────────────────────

async def join_workspace(
    db: AsyncSession, *, email: str, workspace_code: str, password: Optional[str],
) -> None:
    """Idempotently enqueue a pending self-join for `email` in the workspace.

    Silent no-op for unknown codes / existing members (the router returns the
    same soft ack either way so codes can't be enumerated). Raises 403 only when
    the tenant is at its active-seat limit.
    """
    # 1. Resolve the workspace_code → tenant. Case-insensitive lookup matches
    #    the unique index on upper(workspace_code) created by the migration.
    tenant = await get_tenant_by_workspace_code(
        db, workspace_code, columns="id, name, seat_limit"
    )
    if not tenant:
        logger.info("join: unknown workspace_code=%r email=%r", workspace_code, email)
        return

    # 2. Already in the tenant? Idempotent no-op.
    existing = (await db.execute(
        text("""
            SELECT id, is_active FROM users
             WHERE tenant_id = :tid AND lower(email) = lower(:email)
        """),
        {"tid": tenant["id"], "email": email},
    )).mappings().first()
    if existing:
        logger.info("join: already in tenant tenant_id=%s email=%s", tenant["id"], email)
        return

    # 3. Seat-limit check — count only ACTIVE users (#125: pending rows must not
    #    block legitimate onboarding).
    used = (await db.execute(
        text("SELECT COUNT(*) AS n FROM users WHERE tenant_id=:tid AND is_active=true"),
        {"tid": tenant["id"]},
    )).scalar_one()
    if used >= tenant["seat_limit"]:
        # Surface this honestly — the supervisor needs to know their workspace is full.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Workspace '{tenant['name']}' has reached its seat limit "
                f"({tenant['seat_limit']}). Ask your supervisor to upgrade."
            ),
        )

    # 4. Insert a pending row directly. is_active=false → user will see the
    #    "pending" message on login until the supervisor assigns a role.
    await db.execute(
        text("""
            INSERT INTO users (id, tenant_id, role, email, name, is_active, password_hash)
            VALUES (:id, :tenant_id, 'executive', :email, :name, false, :pwd)
        """),
        {
            "id":        uuid.uuid4(),
            "tenant_id": tenant["id"],
            "email":     email,
            "name":      email.split("@")[0],
            "pwd":       (await hash_password_async(password)) if password else None,
        },
    )
    await db.commit()
    logger.info(
        "join: pending user created tenant_id=%s email=%s code=%s",
        tenant["id"], email, workspace_code,
    )


# ── Branding ────────────────────────────────────────────────────────────────

async def get_tenant_for_branding(db: AsyncSession, tenant_id: str) -> Optional[Mapping[str, Any]]:
    """The tenant's id/name/logo_url, or None if the tenant does not exist."""
    return (await db.execute(
        text("SELECT id, name, logo_url FROM tenants WHERE id = :id"),
        {"id": tenant_id},
    )).mappings().first()


async def update_tenant_branding(
    db: AsyncSession, *, tenant_id: str, name: str, logo: Optional[str],
) -> None:
    """Last-write-wins update of a tenant's display name + logo path (commits)."""
    await db.execute(
        text("UPDATE tenants SET name = :name, logo_url = :logo WHERE id = :id"),
        {"name": name, "logo": logo, "id": tenant_id},
    )
    await db.commit()


# ── Password-reset queue (platform admin) ────────────────────────────────────

async def confirm_password_reset_request(db: AsyncSession, request_id: str) -> str:
    """Approve a reset request and return the one-time plaintext token (commits).

    Raises 404 (missing), 409 (already decided), or 422 (no matching user).
    """
    req = (await db.execute(
        text("SELECT id, status, user_id FROM password_reset_requests WHERE id = :id"),
        {"id": request_id},
    )).mappings().first()
    if not req:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reset request not found.")
    if req["status"] != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Request already {req['status']}.")
    if not req["user_id"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Request has no matching user in the workspace.",
        )
    # Bind the approval to a single-use token (#85). The plaintext is returned
    # ONCE to the platform admin, who relays it to the requester out-of-band
    # (same trust channel as workspace codes); only its hash is stored.
    reset_token = secrets.token_urlsafe(24)
    token_hash = hashlib.sha256(reset_token.encode()).hexdigest()
    await db.execute(
        text("""UPDATE password_reset_requests
                   SET status = 'approved', approved_at = now(),
                       reset_token_hash = :th,
                       token_expires_at = now() + interval '7 days'
                 WHERE id = :id"""),
        {"id": request_id, "th": token_hash},
    )
    await db.commit()
    logger.info("password reset approved request_id=%s", request_id)
    return reset_token
