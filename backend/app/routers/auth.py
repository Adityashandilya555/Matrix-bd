"""Auth router.

The platform issues its own short-lived JWTs at sign-in time. We do NOT
delegate to Supabase Auth — the GoTrue dance (passwords, email confirmation,
magic links) was more friction than this MVP needs.

Sign-in credential is the (email, workspace_code) pair:

  - email          → identifies the user inside the tenant
  - workspace_code → identifies the tenant + acts as a shared secret the
                     supervisor hands to their team

A user who shows up with a valid workspace_code is allowed to enter the
queue. The supervisor reviews them on /team and assigns a role. Until that
happens the user sees a "pending" message — no JWT is issued.

Routes:
    POST /auth/login   — public; returns either a JWT (active) or 202 (pending)
    GET  /auth/whoami  — authed; echoes decoded claims (handy for the UI)
    POST /auth/logout  — courtesy; clients should also drop their local token
"""
from __future__ import annotations

import hashlib
import logging
import re
import secrets
import uuid
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import text

from app.core.config import settings
from app.core.deps import CurrentUser, DbDep
from app.core.ratelimit import rate_limit
from app.core.security import (
    TOKEN_TTL_SECONDS,
    decode_token_for_refresh,
    issue_token,
)
from app.core.passwords import hash_password_async, verify_password_async
from app.domain.schemas.common import OkResponse

logger = logging.getLogger("matrix.auth")

router = APIRouter(prefix="/auth", tags=["Auth"])

_EMAIL_RE   = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_WS_CODE_RE = re.compile(r"^[A-Za-z0-9\-]{4,32}$")


class _WorkspaceCred(BaseModel):
    """Email + workspace_code with shared validation."""
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


class LoginIn(_WorkspaceCred):
    # Optional only for tenants in PASSWORDLESS_DEMO_CODES (sample/demo
    # workspaces). For everyone else a password is required once set, and an
    # account with no password cannot sign in at all (#83) — first-time
    # passwords are set through the admin-approved, token-bound reset flow.
    password: Optional[str] = Field(default=None, max_length=256)


class LoginCheckIn(_WorkspaceCred):
    pass


class ResetRequestIn(_WorkspaceCred):
    pass


class ResetCompleteIn(_WorkspaceCred):
    new_password: str = Field(min_length=6, max_length=256)
    # Single-use token issued at admin approval (#85). Without it, anyone who
    # knew (email, workspace_code) could finalize an approved reset and take
    # over the account.
    reset_token: str = Field(min_length=8, max_length=128)


class LoginOut(BaseModel):
    access_token: str
    token_type:   str = "bearer"  # noqa: S105 — OAuth token *type* label, not a secret
    expires_in:   int = TOKEN_TTL_SECONDS
    user: dict


class PendingOut(BaseModel):
    status:  str = "pending"
    message: str


class SupervisorSignupIn(BaseModel):
    email:     EmailStr
    dept_code: str


class ExecutiveSignupIn(BaseModel):
    email:           EmailStr
    supervisor_code: str


class SignupAcceptedOut(BaseModel):
    message: str
    user_id: str


@router.post(
    "/login",
    summary="Public: exchange (email, workspace_code) for a JWT",
    dependencies=[Depends(rate_limit(times=10, seconds=60))],
    responses={
        200: {"description": "Active user — JWT returned"},
        202: {"description": "Pending user — supervisor must assign role"},
        403: {"description": "Workspace seat limit reached"},
    },
)
async def login(payload: LoginIn, db: DbDep):
    # 1. Resolve workspace code → tenant.
    tenant = (await db.execute(
        text("""
            SELECT id, name, seat_limit
              FROM tenants
             WHERE upper(workspace_code) = upper(:code)
        """),
        {"code": payload.workspace_code},
    )).mappings().first()
    if not tenant:
        # Same soft 202 a valid code + unknown email gets — a 404 here was a
        # valid-code enumeration oracle (#84). Discriminator logged server-side.
        logger.info("login: unknown workspace_code=%r", payload.workspace_code)
        return _pending_response(payload.email)

    # 2. Find the user by (tenant, email).
    user = (await db.execute(
        text("""
            SELECT id, email, name, role, is_active, assigned_city, password_hash
              FROM users
             WHERE tenant_id = :tid AND lower(email) = lower(:email)
        """),
        {"tid": tenant["id"], "email": payload.email},
    )).mappings().first()

    if user is None:
        # First-time login from this email in this workspace — register them
        # in the queue. The supervisor will assign a role.
        # Count only ACTIVE users — pending (is_active=false) rows must not
        # consume seats; otherwise any holder of the workspace_code can fill
        # the workspace with never-approved registrations, blocking real hires
        # with a 403 (#125).
        seat_used = (await db.execute(
            text("SELECT COUNT(*) FROM users WHERE tenant_id=:tid AND is_active=true"),
            {"tid": tenant["id"]},
        )).scalar_one()
        if seat_used >= tenant["seat_limit"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Workspace '{tenant['name']}' is full ({tenant['seat_limit']} seats). "
                    "Ask your supervisor to free a seat or upgrade."
                ),
            )
        new_id = uuid.uuid4()
        await db.execute(
            text("""
                INSERT INTO users (id, tenant_id, role, email, name, is_active, password_hash)
                VALUES (:id, :tid, 'executive', :email, :name, false, :pwd)
            """),
            {
                "id":    new_id,
                "tid":   tenant["id"],
                "email": payload.email,
                "name":  payload.email.split("@")[0],
                "pwd":   (await hash_password_async(payload.password)) if payload.password else None,
            },
        )
        await db.commit()
        logger.info(
            "login: queued new user tenant_id=%s email=%s",
            tenant["id"], payload.email,
        )
        return _pending_response(payload.email)

    # 3. Known user. If still inactive (no role assigned), keep them pending.
    if not user["is_active"]:
        return _pending_response(payload.email)

    # 3b. Password gate (#83). An account with a password must present it. An
    #     account WITHOUT one can no longer sign in (previously it fell through
    #     to a full JWT, and the first password anyone submitted was silently
    #     stored — an account-claim race on every freshly provisioned user).
    #     First-time passwords are set via the admin-approved, token-bound
    #     reset flow (#85). Sample/demo tenants can be exempted explicitly.
    stored_hash = user["password_hash"]
    provided = (payload.password or "").strip()
    is_demo_tenant = payload.workspace_code.strip().upper() in settings.passwordless_demo_code_list
    if stored_hash:
        if not await verify_password_async(provided, stored_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect email or password.",
            )
    elif not is_demo_tenant:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "This account does not have a password yet. Use 'Request a reset' "
                "on the login page — once the platform admin approves it you'll "
                "receive a reset code to set your password."
            ),
        )

    # 4. Active user → mint a JWT. Optionally enrich with module membership.
    # A user may belong to multiple modules (the table only enforces
    # UNIQUE(user_id, module)). Without an ORDER BY, Postgres returns an
    # arbitrary row, so the JWT's module claim — and therefore which
    # require_module routes the user can reach — flips between logins (#124).
    # Order deterministically so the chosen module is stable across sessions.
    membership = (await db.execute(
        text("""
            SELECT module, role_in_module, supervisor_id
              FROM user_module_memberships
             WHERE user_id = :uid
             ORDER BY module
             LIMIT 1
        """),
        {"uid": user["id"]},
    )).mappings().first() or {}
    supervisor_id = membership.get("supervisor_id")
    token = issue_token(
        sub=str(user["id"]),
        email=user["email"],
        name=user["name"] or user["email"].split("@")[0],
        role=user["role"],
        tenant_id=str(tenant["id"]),
        city=user["assigned_city"],
        module=membership.get("module"),
        module_role=membership.get("role_in_module"),
        supervisor_id=str(supervisor_id) if supervisor_id else None,
    )
    return LoginOut(
        access_token=token,
        user={
            "id":         str(user["id"]),
            "email":      user["email"],
            "name":       user["name"],
            "role":       user["role"],
            "tenant_id":  str(tenant["id"]),
            "tenant_name": tenant["name"],
            "city":       user["assigned_city"],
        },
    )


@router.post(
    "/login/check",
    summary="Public: report whether this (email, workspace_code) already has a password set",
    dependencies=[Depends(rate_limit(times=20, seconds=60))],
)
async def login_check(payload: LoginCheckIn, db: DbDep) -> dict:
    """Lets the branded login page choose between 'set a password' (with a
    confirm field) and 'enter your password'. Returns False for unknown
    accounts too, so it does not enumerate users."""
    tenant = (await db.execute(
        text("SELECT id FROM tenants WHERE upper(workspace_code) = upper(:code)"),
        {"code": payload.workspace_code},
    )).mappings().first()
    if not tenant:
        return {"password_set": False}  # nosec B105 — boolean flag, not a credential
    user = (await db.execute(
        text("""SELECT password_hash FROM users
                 WHERE tenant_id = :tid AND lower(email) = lower(:email)"""),
        {"tid": tenant["id"], "email": payload.email},
    )).mappings().first()
    return {"password_set": bool(user and user["password_hash"])}


@router.post(
    "/password-reset/request",
    summary="Public: request a password reset (routed to the platform admin)",
    dependencies=[Depends(rate_limit(times=5, seconds=300))],
)
async def password_reset_request(payload: ResetRequestIn, db: DbDep) -> dict:
    # Soft ack regardless of existence, so this does not leak which emails are
    # registered. A pending request is created only when the account is real.
    soft = {
        "status": "requested",
        "message": "If that account exists, a reset request was sent to the platform admin for approval.",
    }
    tenant = (await db.execute(
        text("SELECT id FROM tenants WHERE upper(workspace_code) = upper(:code)"),
        {"code": payload.workspace_code},
    )).mappings().first()
    if not tenant:
        return soft
    user = (await db.execute(
        text("SELECT id FROM users WHERE tenant_id = :tid AND lower(email) = lower(:email)"),
        {"tid": tenant["id"], "email": payload.email},
    )).mappings().first()
    if not user:
        return soft
    dup = (await db.execute(
        text("""SELECT id FROM password_reset_requests
                 WHERE tenant_id = :tid AND lower(email) = lower(:email) AND status = 'pending'"""),
        {"tid": tenant["id"], "email": payload.email},
    )).mappings().first()
    if not dup:
        await db.execute(
            text("""INSERT INTO password_reset_requests (tenant_id, user_id, email)
                    VALUES (:tid, :uid, :email)"""),
            {"tid": tenant["id"], "uid": user["id"], "email": payload.email},
        )
        await db.commit()
        # PII hygiene (#82): log the user id, not the email.
        logger.info("password reset requested tenant_id=%s user_id=%s", tenant["id"], user["id"])
    return soft


@router.post(
    "/password-reset/complete",
    summary="Public: set a new password using the reset code issued at admin approval",
    dependencies=[Depends(rate_limit(times=5, seconds=300))],
)
async def password_reset_complete(payload: ResetCompleteIn, db: DbDep) -> dict:
    tenant = (await db.execute(
        text("SELECT id FROM tenants WHERE upper(workspace_code) = upper(:code)"),
        {"code": payload.workspace_code},
    )).mappings().first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid reset request.")
    user = (await db.execute(
        text("SELECT id FROM users WHERE tenant_id = :tid AND lower(email) = lower(:email)"),
        {"tid": tenant["id"], "email": payload.email},
    )).mappings().first()
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid reset request.")
    req = (await db.execute(
        text("""SELECT id, reset_token_hash FROM password_reset_requests
                 WHERE tenant_id = :tid AND user_id = :uid AND status = 'approved'
                   AND (token_expires_at IS NULL OR token_expires_at > now())
                 ORDER BY created_at DESC LIMIT 1"""),
        {"tid": tenant["id"], "uid": user["id"]},
    )).mappings().first()
    if not req:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No approved reset request found. Ask the platform admin to approve your reset first.",
        )
    # Bind completion to the requester (#85): the caller must present the
    # single-use token the admin relayed out-of-band. (email, workspace_code)
    # alone is a shared, non-secret pair and must never finalize a reset.
    provided_hash = hashlib.sha256(payload.reset_token.strip().encode()).hexdigest()
    stored_hash = req["reset_token_hash"] or ""
    if not stored_hash or not secrets.compare_digest(provided_hash, stored_hash):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or expired reset code. Ask the platform admin for the code issued with the approval.",
        )
    await db.execute(
        text("UPDATE users SET password_hash = :h WHERE id = :uid"),
        {"h": await hash_password_async(payload.new_password), "uid": user["id"]},
    )
    await db.execute(
        text("UPDATE password_reset_requests SET status = 'completed', completed_at = now() WHERE id = :id"),
        {"id": req["id"]},
    )
    await db.commit()
    logger.info("password reset completed tenant_id=%s user_id=%s", tenant["id"], user["id"])
    return {"status": "reset", "message": "Password updated. You can now sign in with your new password."}


@router.post(
    "/signup/supervisor",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(rate_limit(times=5, seconds=300))],
    summary="Public: sign up as a supervisor candidate using a dept_code",
    responses={
        202: {"description": "Pending — business_admin must approve"},
        404: {"description": "Invalid or revoked dept_code"},
        409: {"description": "Email already active in this workspace"},
    },
)
async def signup_supervisor(
    payload: SupervisorSignupIn, db: DbDep,
) -> SignupAcceptedOut:
    code_row = (await db.execute(
        text("""
            SELECT tenant_id, module
              FROM module_codes
             WHERE code = :code AND revoked_at IS NULL
        """),
        {"code": payload.dept_code},
    )).mappings().first()
    if not code_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="That dept code is not valid.",
        )
    return await _enqueue_signup(
        db,
        tenant_id=code_row["tenant_id"],
        email=payload.email,
        role="supervisor",
        notes=f"pending_module:{code_row['module']}",
    )


@router.post(
    "/signup/executive",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(rate_limit(times=5, seconds=300))],
    summary="Public: sign up as an executive candidate using a supervisor_code",
    responses={
        202: {"description": "Pending — supervisor must approve"},
        404: {"description": "Invalid or revoked supervisor_code"},
        409: {"description": "Email already active in this workspace"},
    },
)
async def signup_executive(
    payload: ExecutiveSignupIn, db: DbDep,
) -> SignupAcceptedOut:
    code_row = (await db.execute(
        text("""
            SELECT tenant_id, supervisor_id, module
              FROM supervisor_invite_codes
             WHERE code = :code AND revoked_at IS NULL
        """),
        {"code": payload.supervisor_code},
    )).mappings().first()
    if not code_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="That supervisor code is not valid.",
        )
    return await _enqueue_signup(
        db,
        tenant_id=code_row["tenant_id"],
        email=payload.email,
        role="executive",
        notes=(
            f"pending_supervisor:{code_row['supervisor_id']}"
            f"|module:{code_row['module']}"
        ),
    )


async def _enqueue_signup(
    db,
    *,
    tenant_id,
    email: str,
    role: str,
    notes: str,
) -> SignupAcceptedOut:
    """Shared dedupe + insert path for the two signup endpoints.

    Returns 202 if a pending row already exists or a new one is created.
    Raises 409 if the email is already active in the tenant.
    """
    existing = (await db.execute(
        text("""
            SELECT id, is_active
              FROM users
             WHERE tenant_id = :tid AND lower(email) = lower(:email)
        """),
        {"tid": tenant_id, "email": email},
    )).mappings().first()
    if existing:
        if existing["is_active"]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="That email is already active in this workspace.",
            )
        return SignupAcceptedOut(
            message="Signup already pending approval.",
            user_id=str(existing["id"]),
        )

    new_id = uuid.uuid4()
    await db.execute(
        text("""
            INSERT INTO users (id, tenant_id, role, email, name, is_active, notes)
            VALUES (:id, :tid, :role, :email, :name, false, :notes)
        """),
        {
            "id":    new_id,
            "tid":   tenant_id,
            "role":  role,
            "email": email,
            "name":  email.split("@")[0],
            "notes": notes,
        },
    )
    await db.commit()
    logger.info(
        "signup: queued %s tenant_id=%s email=%s",
        role, tenant_id, email,
    )
    return SignupAcceptedOut(
        message="Signup received. Awaiting approval.",
        user_id=str(new_id),
    )


def _pending_response(email: str):
    """Wrap the 202 'pending approval' response with the right shape."""
    from fastapi.responses import JSONResponse
    body = PendingOut(
        message=(
            f"You're in the queue. Your supervisor needs to assign you a role "
            f"before you can sign in. (Email {email})"
        ),
    ).model_dump()
    return JSONResponse(content=body, status_code=status.HTTP_202_ACCEPTED)


@router.get("/whoami", summary="Return the decoded session claims")
async def whoami(current_user: CurrentUser) -> dict:
    return current_user


@router.post(
    "/refresh",
    response_model=LoginOut,
    summary="Refresh the current JWT (tolerates a recently-expired token)",
)
async def refresh(
    db: DbDep,
    authorization: Annotated[Optional[str], Header()] = None,
) -> LoginOut:
    """Mint a fresh JWT from the current session.

    Unlike every other authed route this does NOT go through the strict
    ``get_current_user`` dependency. It decodes the bearer with
    ``decode_token_for_refresh``, which still verifies the signature, audience
    and required claims but tolerates a token expired within
    ``REFRESH_GRACE_SECONDS``. That lets a session that lapsed (e.g. a 24h token
    that expired while a tab was open) re-mint silently instead of dead-ending
    into a re-login — the shared root cause behind both the "session paused"
    popup and "pipeline not created", since the old handler depended on the same
    strict decode that rejected the token in the first place.

    Security is preserved: an account that has been deactivated or deleted no
    longer matches the ``is_active = true`` filter below, so it cannot refresh,
    and a token expired beyond the grace window is rejected by the decode.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token. Sign in again.",
        )
    token = authorization.split(" ", 1)[1].strip()
    claims = decode_token_for_refresh(token)

    row = (await db.execute(
        text("""
            SELECT u.id, u.email, u.name, u.role, u.assigned_city,
                   t.id AS tenant_id, t.name AS tenant_name
              FROM users u
              JOIN tenants t ON t.id = u.tenant_id
             WHERE u.id = :uid AND u.is_active = true
        """),
        {"uid": claims["sub"]},
    )).mappings().first()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is inactive or no longer exists. Sign in again.",
        )

    membership = (await db.execute(
        text("""
            SELECT module, role_in_module, supervisor_id
              FROM user_module_memberships
             WHERE user_id = :uid
             ORDER BY module
             LIMIT 1
        """),
        {"uid": row["id"]},
    )).mappings().first() or {}
    supervisor_id = membership.get("supervisor_id")
    token = issue_token(
        sub=str(row["id"]),
        email=row["email"],
        name=row["name"] or row["email"].split("@")[0],
        role=row["role"],
        tenant_id=str(row["tenant_id"]),
        city=row["assigned_city"],
        module=membership.get("module"),
        module_role=membership.get("role_in_module"),
        supervisor_id=str(supervisor_id) if supervisor_id else None,
    )
    return LoginOut(
        access_token=token,
        user={
            "id":          str(row["id"]),
            "email":       row["email"],
            "name":        row["name"],
            "role":        row["role"],
            "tenant_id":   str(row["tenant_id"]),
            "tenant_name": row["tenant_name"],
            "city":        row["assigned_city"],
        },
    )


@router.post(
    "/logout",
    response_model=OkResponse,
    summary="Courtesy logout (clients must also drop their bearer token)",
)
async def logout() -> OkResponse:
    return OkResponse(ok=True, message="Logged out. Discard your bearer token.")
