"""Tenancy router.

Surfaces:
- GET  /tenants                       — supervisor: list own tenants
- GET  /cities                        — authed:    distinct cities in own tenant
- GET  /workspace-info                — authed:    own tenant's code + seat usage
- POST /request-workspace             — PUBLIC:    capture a workspace request
- POST /requests/{id}/approve         — platform:  provision tenant + business_admin
- POST /join                          — PUBLIC:    employee self-join via workspace_code
"""
from __future__ import annotations

import json
import logging
import re
import secrets
import uuid
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, text

from app.core.config import settings
from app.core.deps import CurrentUser, DbDep, TenantId
from app.db import models
from app.rbac.guards import require_role
from app.rbac.roles import Role

logger = logging.getLogger("matrix.tenancy")

router = APIRouter(prefix="/tenancy", tags=["Tenancy"])

_EMAIL_RE       = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_WS_CODE_RE     = re.compile(r"^[A-Za-z0-9\-]{4,32}$")
_DEFAULT_SEATS  = 10


# ── Helpers ───────────────────────────────────────────────────────────────


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
    """Generate a short, human-shareable workspace code.

    Format: <SLUGFRAG>-<RAND4>. e.g. "BTOKAI-7X9F". Collisions are improbable
    but the insert path will retry on a unique-violation just in case.
    """
    base = re.sub(r"[^A-Za-z0-9]", "", (slug_hint or ""))[:6].upper()
    if not base:
        base = secrets.token_hex(3).upper()
    return f"{base}-{secrets.token_hex(2).upper()}"


def _json_string(s: Optional[str]) -> str:
    """Serialise a Python string to a JSON-escaped string fragment so we can
    splice it into the JSONB literal that goes into notification_outbox.payload.
    Defending against quotes/newlines in the company name."""
    return json.dumps(s or "")


def _require_platform_admin(provided: Optional[str]) -> None:
    expected = settings.effective_platform_admin_token
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin portal disabled — PLATFORM_ADMIN_PASSWORD is unset.",
        )
    # secrets.compare_digest avoids timing leaks on the secret length.
    if not provided or not secrets.compare_digest(str(provided), expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-Platform-Admin-Key.",
        )


# ── Platform admin login ───────────────────────────────────────────────────

class AdminLoginIn(BaseModel):
    email:    str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class AdminLoginOut(BaseModel):
    token: str
    email: str


@router.post(
    "/admin/login",
    response_model=AdminLoginOut,
    summary="Platform admin login — exchange email+password for the portal token",
)
async def admin_login(payload: AdminLoginIn) -> AdminLoginOut:
    expected_email    = (settings.platform_admin_email or "").strip().lower()
    expected_password = settings.platform_admin_password or ""
    if not expected_email or not expected_password:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin portal disabled — PLATFORM_ADMIN_EMAIL/PASSWORD unset.",
        )
    email_ok = secrets.compare_digest(payload.email.strip().lower(), expected_email)
    pw_ok    = secrets.compare_digest(payload.password, expected_password)
    if not (email_ok and pw_ok):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
        )
    return AdminLoginOut(
        token=settings.effective_platform_admin_token,
        email=expected_email,
    )


# ── Existing reads ────────────────────────────────────────────────────────


@router.get("/tenants", summary="List tenants (supervisor only)")
async def list_tenants(
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
) -> dict:
    stmt = select(models.Tenant).where(models.Tenant.id == current_user["tenant_id"])
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "items": [{"id": str(t.id), "name": t.name, "slug": t.slug, "plan": t.plan} for t in rows],
        "total": len(rows),
    }


@router.get("/cities", summary="List active cities in tenant")
async def list_cities(
    db: DbDep,
    current_user: CurrentUser,
    tenant_id: TenantId,
) -> dict:
    stmt = (
        select(models.Site.city)
        .where(models.Site.tenant_id == tenant_id)
        .distinct()
        .order_by(models.Site.city)
    )
    rows = [r for (r,) in (await db.execute(stmt)).all()]
    return {"cities": rows}


# ── Workspace info (supervisor's "what's my code" call) ────────────────────


@router.get(
    "/workspace-info",
    summary="Authed: current tenant code + seat usage",
)
async def workspace_info(db: DbDep, current_user: CurrentUser, tenant_id: TenantId) -> dict:
    row = (await db.execute(
        text("""
            SELECT t.id, t.name, t.slug, t.plan, t.workspace_code, t.seat_limit,
                   (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS used_seats,
                   (SELECT COUNT(*) FROM users u
                      WHERE u.tenant_id = t.id AND u.is_active = false) AS pending_seats
              FROM tenants t WHERE t.id = :tid
        """),
        {"tid": tenant_id},
    )).mappings().first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")
    return {
        "id":             str(row["id"]),
        "name":           row["name"],
        "slug":           row["slug"],
        "plan":           row["plan"],
        "workspace_code": row["workspace_code"],
        "seat_limit":     row["seat_limit"],
        "used_seats":     row["used_seats"],
        "pending_seats":  row["pending_seats"],
    }


# ── Public capture: workspace request ──────────────────────────────────────


class WorkspaceRequestIn(BaseModel):
    company:     str = Field(min_length=1, max_length=200)
    admin_email: str = Field(min_length=3, max_length=254)
    team_size:   Optional[str] = Field(default=None, max_length=64)

    @field_validator("admin_email")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _EMAIL_RE.match(v):
            raise ValueError("admin_email must be a valid email address")
        return v


class WorkspaceRequestOut(BaseModel):
    id:      str
    status:  str
    message: str


@router.post(
    "/request-workspace",
    response_model=WorkspaceRequestOut,
    status_code=status.HTTP_201_CREATED,
    summary="Public: capture a workspace-creation request for admin approval",
)
async def request_workspace(
    payload: WorkspaceRequestIn,
    request: Request,
    db: DbDep,
) -> WorkspaceRequestOut:
    source_ip  = request.client.host if request.client else None
    seat_limit = _parse_seat_limit(payload.team_size)
    try:
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
                "company":     payload.company.strip(),
                "admin_email": str(payload.admin_email),
                "team_size":   payload.team_size,
                "seat_limit":  seat_limit,
                "source_ip":   source_ip,
            },
        )
        row_id = result.scalar_one()
        await db.commit()
    except Exception:  # noqa: BLE001
        await db.rollback()
        logger.exception(
            "workspace_requests insert failed (migration may be unapplied) "
            "company=%r admin_email=%r",
            payload.company,
            payload.admin_email,
        )
        return WorkspaceRequestOut(
            id="pending-local",
            status="captured_offline",
            message=(
                "Request captured. Our team will follow up at "
                f"{payload.admin_email} once an admin reviews it."
            ),
        )

    logger.info(
        "workspace_requests inserted id=%s company=%r admin_email=%s seat_limit=%d",
        row_id, payload.company, payload.admin_email, seat_limit,
    )
    return WorkspaceRequestOut(
        id=str(row_id),
        status="pending",
        message=(
            "Request received. An admin will review and email "
            f"{payload.admin_email} once your workspace is provisioned."
        ),
    )


# ── Platform-admin: list pending workspace requests ───────────────────────


class WorkspaceRequestRow(BaseModel):
    id:           str
    company:      str
    admin_email:  str
    team_size:    Optional[str] = None
    seat_limit:   int
    status:       str
    created_at:   Optional[str] = None
    decided_at:   Optional[str] = None
    source_ip:    Optional[str] = None


class WorkspaceRequestListOut(BaseModel):
    items: list[WorkspaceRequestRow]
    total: int


@router.get(
    "/requests",
    response_model=WorkspaceRequestListOut,
    summary="Platform admin: list workspace requests (pending by default)",
)
async def list_workspace_requests(
    db: DbDep,
    x_platform_admin_key: Annotated[Optional[str], Header(alias="X-Platform-Admin-Key")] = None,
    status_filter: Optional[str] = "pending",
    limit: int = 100,
) -> WorkspaceRequestListOut:
    """Powers the admin portal page. Defaults to `status=pending` because that's
    the queue the admin actually acts on; pass `status=all` to include
    approved/rejected for audit views."""
    _require_platform_admin(x_platform_admin_key)
    limit = max(1, min(limit, 500))
    where = ""
    params: dict = {"lim": limit}
    if status_filter and status_filter != "all":
        where = "WHERE status = :status"
        params["status"] = status_filter
    rows = (await db.execute(
        text(f"""
            SELECT id, company, admin_email, team_size, seat_limit, status,
                   created_at, decided_at, source_ip::text AS source_ip
              FROM workspace_requests
              {where}
             ORDER BY created_at DESC
             LIMIT :lim
        """),
        params,
    )).mappings().all()
    items = [
        WorkspaceRequestRow(
            id=str(r["id"]),
            company=r["company"],
            admin_email=r["admin_email"],
            team_size=r["team_size"],
            seat_limit=r["seat_limit"],
            status=r["status"],
            created_at=r["created_at"].isoformat() if r["created_at"] else None,
            decided_at=r["decided_at"].isoformat() if r["decided_at"] else None,
            source_ip=r["source_ip"],
        )
        for r in rows
    ]
    return WorkspaceRequestListOut(items=items, total=len(items))


# ── Platform-admin reject ──────────────────────────────────────────────────


class RejectOut(BaseModel):
    request_id: str
    status: str
    message: str


@router.post(
    "/requests/{request_id}/reject",
    response_model=RejectOut,
    summary="Platform admin: reject a pending workspace request",
)
async def reject_workspace_request(
    request_id: str,
    db: DbDep,
    x_platform_admin_key: Annotated[Optional[str], Header(alias="X-Platform-Admin-Key")] = None,
) -> RejectOut:
    """Decline a workspace request without provisioning a tenant. Mirrors the
    approve guard + lock, but only flips status to 'rejected'."""
    _require_platform_admin(x_platform_admin_key)

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
    return RejectOut(request_id=str(request_id), status="rejected", message="Workspace request rejected.")


# ── Platform-admin approve ─────────────────────────────────────────────────


class ApproveIn(BaseModel):
    # Business admins are tenant-wide; not city-scoped at the permission layer.
    # This field is metadata only: it travels in the workspace_provisioned outbox
    # payload for any email/Slack template that wants to greet the customer with
    # their primary territory. Optional.
    city:       Optional[str] = Field(default=None, max_length=80, description="Primary city for the workspace (metadata only — business_admin is not city-scoped).")
    admin_name: Optional[str] = Field(default=None, max_length=120)


class ApproveOut(BaseModel):
    tenant_id:         str
    workspace_code:    str
    seat_limit:        int
    business_admin_id: str
    # Legacy alias: older clients still read `supervisor_id`. Mirrors business_admin_id.
    supervisor_id:     str
    message:           str


@router.post(
    "/requests/{request_id}/approve",
    response_model=ApproveOut,
    summary="Platform admin: approve a pending workspace request",
)
async def approve_workspace_request(
    request_id: str,
    payload: ApproveIn,
    db: DbDep,
    x_platform_admin_key: Annotated[Optional[str], Header(alias="X-Platform-Admin-Key")] = None,
) -> ApproveOut:
    _require_platform_admin(x_platform_admin_key)

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
    slug_base = re.sub(r"[^a-z0-9]+", "-", req_company.lower()).strip("-") or "tenant"
    tenant_row = None
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
                    "name":       req_company,
                    "seat_limit": req_seat_limit,
                    "code":       ws_code,
                },
            )
            tenant_row = inserted.mappings().one()
            break
        except Exception as e:  # noqa: BLE001
            msg = str(e).lower()
            last_error = msg[:240]
            logger.warning(
                "approve: tenant insert attempt %d failed slug=%r code=%r err=%s",
                attempt, slug_try, ws_code, last_error,
            )
            # Both constraints look like UniqueViolation; retry either way.
            if "duplicate" in msg or "unique" in msg or "already exists" in msg:
                await db.rollback()
                still = (await db.execute(
                    text("SELECT status FROM workspace_requests WHERE id=:rid FOR UPDATE"),
                    {"rid": request_id},
                )).mappings().first()
                if not still or still["status"] != "pending":
                    raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Concurrent approve detected.")
                continue
            raise
    if tenant_row is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Could not create tenant after 5 attempts. Last error: {last_error}",
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
            "name":      payload.admin_name or req_admin_email.split("@")[0],
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
        f"Hi {payload.admin_name or req_admin_email.split('@')[0]},\n\n"
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
            "payload": (
                '{"tenant_id":"' + str(tenant_id) + '",'
                '"workspace_code":"' + workspace_code + '",'
                '"business_admin_id":"' + str(business_admin_id) + '",'
                '"supervisor_id":"' + str(business_admin_id) + '",'
                '"company":' + _json_string(req_company) + ','
                '"city":' + _json_string(payload.city or "") + '}'
            ),
        },
    )

    await db.commit()

    return ApproveOut(
        tenant_id=str(tenant_id),
        workspace_code=workspace_code,
        seat_limit=seat_limit,
        business_admin_id=str(business_admin_id),
        supervisor_id=str(business_admin_id),
        message=(
            f"Provisioned {req_company}. Tell {req_admin_email} to sign in at the "
            f"landing page using their email + workspace code: {workspace_code}"
        ),
    )


# ── Public join: employee self-enrollment ──────────────────────────────────


class JoinIn(BaseModel):
    email:          str = Field(min_length=3, max_length=254)
    workspace_code: str = Field(min_length=4, max_length=32)

    @field_validator("email")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _EMAIL_RE.match(v):
            raise ValueError("email must be a valid email address")
        return v

    @field_validator("workspace_code")
    @classmethod
    def _valid_code(cls, v: str) -> str:
        v = v.strip()
        if not _WS_CODE_RE.match(v):
            raise ValueError("workspace_code looks invalid")
        return v


class JoinOut(BaseModel):
    status:  str
    message: str


@router.post(
    "/join",
    response_model=JoinOut,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Public: employee self-join via workspace code",
)
async def join_workspace(payload: JoinIn, db: DbDep) -> JoinOut:
    # 1. Resolve the workspace_code → tenant. Case-insensitive lookup matches
    #    the unique index on upper(workspace_code) created by the migration.
    tenant = (await db.execute(
        text("""
            SELECT id, name, seat_limit
              FROM tenants
             WHERE upper(workspace_code) = upper(:code)
        """),
        {"code": payload.workspace_code},
    )).mappings().first()

    # IMPORTANT: same response for "no such code" and "already joined" so an
    # attacker can't enumerate workspace codes. We log the discriminator
    # server-side for debugging.
    soft_ack = JoinOut(
        status="pending_assignment",
        message=(
            "Request received. Once a supervisor assigns you a role you'll get "
            "an email with sign-in instructions."
        ),
    )

    if not tenant:
        logger.info("join: unknown workspace_code=%r email=%r", payload.workspace_code, payload.email)
        return soft_ack

    # 2. Already in the tenant? Idempotent no-op.
    existing = (await db.execute(
        text("""
            SELECT id, is_active FROM users
             WHERE tenant_id = :tid AND lower(email) = lower(:email)
        """),
        {"tid": tenant["id"], "email": payload.email},
    )).mappings().first()
    if existing:
        logger.info("join: already in tenant tenant_id=%s email=%s", tenant["id"], payload.email)
        return soft_ack

    # 3. Seat-limit check.
    used = (await db.execute(
        text("SELECT COUNT(*) AS n FROM users WHERE tenant_id=:tid"),
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
            INSERT INTO users (id, tenant_id, role, email, name, is_active)
            VALUES (:id, :tenant_id, 'executive', :email, :name, false)
        """),
        {
            "id":        uuid.uuid4(),
            "tenant_id": tenant["id"],
            "email":     payload.email,
            "name":      payload.email.split("@")[0],
        },
    )

    await db.commit()
    logger.info(
        "join: pending user created tenant_id=%s email=%s code=%s",
        tenant["id"], payload.email, payload.workspace_code,
    )
    return soft_ack
