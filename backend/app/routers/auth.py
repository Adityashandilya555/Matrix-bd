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

import logging
import re
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import text

from app.core.deps import CurrentUser, DbDep
from app.core.security import TOKEN_TTL_SECONDS, issue_token
from app.core.passwords import hash_password, verify_password
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
    # Optional for back-compat: a legacy user with no password set may still
    # sign in passwordlessly, and the first password they submit is stored.
    password: Optional[str] = Field(default=None, max_length=256)


class LoginCheckIn(_WorkspaceCred):
    pass


class ResetRequestIn(_WorkspaceCred):
    pass


class ResetCompleteIn(_WorkspaceCred):
    new_password: str = Field(min_length=6, max_length=256)


class LoginOut(BaseModel):
    access_token: str
    token_type:   str = "bearer"
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
    responses={
        200: {"description": "Active user — JWT returned"},
        202: {"description": "Pending user — supervisor must assign role"},
        404: {"description": "Workspace code does not exist"},
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
        # Same response shape as "wrong code" — don't leak which case it is.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="That workspace code does not match any active workspace.",
        )

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
        seat_used = (await db.execute(
            text("SELECT COUNT(*) FROM users WHERE tenant_id=:tid"),
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
                "pwd":   hash_password(payload.password) if payload.password else None,
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

    # 3b. Password gate. Legacy users (password_hash IS NULL) may still sign in
    #     without a password (back-compat). Once a password is set it is
    #     required; the first password a user submits is stored.
    stored_hash = user["password_hash"]
    provided = (payload.password or "").strip()
    if stored_hash:
        if not verify_password(provided, stored_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect email or password.",
            )
    elif provided:
        await db.execute(
            text("UPDATE users SET password_hash = :h WHERE id = :uid"),
            {"h": hash_password(provided), "uid": user["id"]},
        )
        await db.commit()

    # 4. Active user → mint a JWT. Optionally enrich with module membership.
    membership = (await db.execute(
        text("""
            SELECT module, role_in_module, supervisor_id
              FROM user_module_memberships
             WHERE user_id = :uid
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
        return {"password_set": False}
    user = (await db.execute(
        text("""SELECT password_hash FROM users
                 WHERE tenant_id = :tid AND lower(email) = lower(:email)"""),
        {"tid": tenant["id"], "email": payload.email},
    )).mappings().first()
    return {"password_set": bool(user and user["password_hash"])}


@router.post(
    "/password-reset/request",
    summary="Public: request a password reset (routed to the platform admin)",
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
        logger.info("password reset requested tenant_id=%s email=%s", tenant["id"], payload.email)
    return soft


@router.post(
    "/password-reset/complete",
    summary="Public: set a new password once the platform admin has approved the request",
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
        text("""SELECT id FROM password_reset_requests
                 WHERE tenant_id = :tid AND user_id = :uid AND status = 'approved'
                 ORDER BY created_at DESC LIMIT 1"""),
        {"tid": tenant["id"], "uid": user["id"]},
    )).mappings().first()
    if not req:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No approved reset request found. Ask the platform admin to approve your reset first.",
        )
    await db.execute(
        text("UPDATE users SET password_hash = :h WHERE id = :uid"),
        {"h": hash_password(payload.new_password), "uid": user["id"]},
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
    "/logout",
    response_model=OkResponse,
    summary="Courtesy logout (clients must also drop their bearer token)",
)
async def logout() -> OkResponse:
    return OkResponse(ok=True, message="Logged out. Discard your bearer token.")
