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
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text

from app.core.deps import CurrentUser, DbDep
from app.core.security import TOKEN_TTL_SECONDS, issue_token
from app.domain.schemas.common import OkResponse

logger = logging.getLogger("matrix.auth")

router = APIRouter(prefix="/auth", tags=["Auth"])

_EMAIL_RE   = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_WS_CODE_RE = re.compile(r"^[A-Za-z0-9\-]{4,32}$")


class LoginIn(BaseModel):
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


class LoginOut(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    expires_in:   int = TOKEN_TTL_SECONDS
    user: dict


class PendingOut(BaseModel):
    status:  str = "pending"
    message: str


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
            SELECT id, email, name, role, is_active, assigned_city
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
                INSERT INTO users (id, tenant_id, role, email, name, is_active)
                VALUES (:id, :tid, 'executive', :email, :name, false)
            """),
            {
                "id":    new_id,
                "tid":   tenant["id"],
                "email": payload.email,
                "name":  payload.email.split("@")[0],
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

    # 4. Active user → mint a JWT.
    token = issue_token(
        sub=str(user["id"]),
        email=user["email"],
        name=user["name"] or user["email"].split("@")[0],
        role=user["role"],
        tenant_id=str(tenant["id"]),
        city=user["assigned_city"],
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
