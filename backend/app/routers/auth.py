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
import urllib.parse

import hashlib
import logging
import re
import secrets
import uuid
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
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
from app.services.auth_repo import get_tenant_by_workspace_code, get_user_by_tenant_email

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


class PasswordSetupIn(_WorkspaceCred):
    # First-time, self-service password for an already-approved account that
    # has none yet. No token: an approved user sets their own password directly
    # after admin approval, removing the deadstate where a freshly approved
    # supervisor/executive could never log in. Only ever fires once per account
    # (the setup handler's UPDATE is guarded on `password_hash IS NULL`); an
    # account that already has a password must use the token-bound reset flow.
    new_password: str = Field(min_length=6, max_length=256)


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
    # 1+2. Resolve workspace → tenant AND the (tenant, email) user in ONE round
    # trip (#234). A LEFT JOIN anchored on tenants collapses two serial Supabase
    # -pooler round-trips into one while keeping the two distinct "no tenant" vs
    # "no user" branches below distinguishable. The membership lookup (step 4)
    # stays a separate query — it depends on user_id and carries its own ORDER BY.
    row = (await db.execute(
        text("""
            SELECT t.id   AS tenant_id,
                   t.name AS tenant_name,
                   t.seat_limit,
                   u.id   AS user_id,
                   u.email,
                   u.name AS user_name,
                   u.role,
                   u.is_active,
                   u.assigned_city,
                   u.password_hash
              FROM tenants t
              LEFT JOIN users u
                ON u.tenant_id = t.id AND lower(u.email) = lower(:email)
             WHERE upper(t.workspace_code) = upper(:code)
        """),
        {"code": payload.workspace_code, "email": payload.email},
    )).mappings().first()
    if row is None:
        # Same soft 202 a valid code + unknown email gets — a 404 here was a
        # valid-code enumeration oracle (#84). Discriminator logged server-side.
        logger.info("login: unknown workspace_code=%r", payload.workspace_code)
        return _pending_response(payload.email)

    if row["user_id"] is None:
        # The email is not a member of this workspace. We no longer silently
        # auto-register it as a pending "ghost" user (that let any holder of the
        # workspace_code seed never-approved rows, and made a stranger's email
        # indistinguishable from a real member in the UI). Tell the caller
        # plainly instead. Joining is an explicit action via the signup codes
        # (the "Join" tab) — the workspace_code alone is not an invitation.
        # NOTE: this reveals in-workspace email membership by design (the
        # unknown-workspace_code branch above stays a soft 202, so the
        # workspace_code itself remains a non-oracle, #84).
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "This email isn't registered in this workspace. "
                "Ask your admin for an invite, or use the Join tab to request access."
            ),
        )

    # 3. Known user. If still inactive (no role assigned), keep them pending.
    if not row["is_active"]:
        return _pending_response(payload.email)

    # 3b. Password gate (#83). An account with a password must present it. An
    #     account WITHOUT one can no longer sign in (previously it fell through
    #     to a full JWT, and the first password anyone submitted was silently
    #     stored — an account-claim race on every freshly provisioned user).
    #     First-time passwords are set via the admin-approved, token-bound
    #     reset flow (#85). Sample/demo tenants can be exempted explicitly.
    stored_hash = row["password_hash"]
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
        {"uid": row["user_id"]},
    )).mappings().first() or {}
    supervisor_id = membership.get("supervisor_id")
    token = issue_token(
        sub=str(row["user_id"]),
        email=row["email"],
        name=row["user_name"] or row["email"].split("@")[0],
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
            "id":         str(row["user_id"]),
            "email":      row["email"],
            "name":       row["user_name"],
            "role":       row["role"],
            "tenant_id":  str(row["tenant_id"]),
            "tenant_name": row["tenant_name"],
            "city":       row["assigned_city"],
        },
    )


def _is_trusted_internal(request: Request) -> bool:
    """Return True only when the request looks like it came from our own SPA.

    Two conditions must both be met (CodeAnt review — Critical):
      1. The ``X-Matrix-Internal: 1`` header is present.
      2. The ``Origin`` (or ``Referer``) header matches one of the CORS
         origins configured in ``settings.cors_origin_list``.

    Browsers enforce Origin/Referer — they cannot be spoofed from JS running
    on a different origin.  curl/Postman can fake them, but those are not
    browser-context attacks; the opaque fallback + rate-limit handles that.
    """
    if request.headers.get("X-Matrix-Internal") != "1":
        return False
    origin = request.headers.get("origin") or ""
    if not origin:
        # Fall back to Referer (some older browsers / non-CORS POST).
        referer = request.headers.get("referer") or ""
        if referer:
            parsed = urllib.parse.urlparse(referer)
            origin = f"{parsed.scheme}://{parsed.netloc}"
    if not origin:
        return False
    # Trust the SAME origins the CORS middleware admits — both the exact
    # allow-list AND the regex (e.g. Vercel deploy URLs). Previously this checked
    # only the exact list, so a first-party SPA served from a regex-allowed origin
    # passed CORS but was treated as untrusted here, collapsing login/check to the
    # opaque response and breaking the set-vs-enter-password routing (#313 regression).
    if origin in settings.cors_origin_list:
        return True
    regex = settings.effective_cors_origin_regex
    return bool(regex and re.match(regex, origin))


@router.post(
    "/login/check",
    summary="Public: report whether this (email, workspace_code) already has a password set",
    dependencies=[Depends(rate_limit(times=20, seconds=60))],
)
async def login_check(payload: LoginCheckIn, request: Request, db: DbDep) -> dict:
    """Lets the branded login page route the email to the right next step:
    'unknown' (not a member → show an error), 'pending' (approval not granted
    yet), 'needs_password' (approved but no password → self-service setup), or
    'active' (has a password → ask for it).

    Issue #313: to prevent email-membership enumeration by anonymous callers,
    the detailed ``account_state`` is only returned when the request is a
    trusted first-party call (``X-Matrix-Internal: 1`` header AND a matching
    ``Origin``/``Referer`` from an allowed CORS origin).  All other callers
    receive an opaque ``{ "account_state": "checked" }`` that reveals nothing
    about whether the email is a member.  The rate-limit (20/min) remains the
    primary defence.
    """
    # Determine whether this is a trusted first-party call.
    _is_internal = _is_trusted_internal(request)

    unknown = {"account_state": "unknown", "password_set": False}  # nosec B105 — flags, not a credential
    tenant = await get_tenant_by_workspace_code(db, payload.workspace_code)
    if not tenant:
        return unknown if _is_internal else {"account_state": "checked"}
    user = await get_user_by_tenant_email(
        db, tenant["id"], payload.email, columns="is_active, password_hash"
    )
    if not user:
        return unknown if _is_internal else {"account_state": "checked"}

    # Build the detailed response (only exposed to internal callers).
    if not user["is_active"]:
        detail = {"account_state": "pending", "password_set": False}
    elif user["password_hash"]:
        detail = {"account_state": "active", "password_set": True}
    else:
        detail = {"account_state": "needs_password", "password_set": False}

    if _is_internal:
        return detail
    # External callers get a generic response that doesn't leak membership.
    return {"account_state": "checked"}


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
    tenant = await get_tenant_by_workspace_code(db, payload.workspace_code)
    if not tenant:
        return soft
    user = await get_user_by_tenant_email(db, tenant["id"], payload.email)
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
    tenant = await get_tenant_by_workspace_code(db, payload.workspace_code)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid reset request.")
    user = await get_user_by_tenant_email(db, tenant["id"], payload.email)
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
    "/password-setup",
    summary="Public: set a first password for an approved account that has none yet",
    dependencies=[Depends(rate_limit(times=5, seconds=300))],
    responses={
        200: {"description": "Password created — user can now sign in"},
        403: {"description": "Account not approved yet"},
        404: {"description": "Email is not a member of this workspace"},
        409: {"description": "Account already has a password — use the reset flow"},
    },
)
async def password_setup(payload: PasswordSetupIn, db: DbDep) -> dict:
    """Self-service first password (fixes the post-approval deadstate).

    An admin approval flips the user to ``is_active=true`` but leaves
    ``password_hash=NULL``; this lets that user set their own password directly
    instead of waiting on the platform-admin-relayed reset token. It is the only
    writer of a first password and can fire exactly once: the UPDATE is guarded
    on ``password_hash IS NULL``, so a double-submit (or anyone racing for the
    account) finds the row already set and gets a 409, never an overwrite.
    """
    tenant = await get_tenant_by_workspace_code(db, payload.workspace_code)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid request.")
    user = await get_user_by_tenant_email(
        db, tenant["id"], payload.email, columns="id, is_active, password_hash"
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                "This email isn't registered in this workspace. "
                "Ask your admin for an invite, or use the Join tab to request access."
            ),
        )
    if not user["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your access is still pending approval. You can set a password once an admin approves you.",
        )
    if user["password_hash"]:
        # Fast path for the common case; the guarded UPDATE below is the real
        # race-safe gate.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This account already has a password. Use 'Forgot your password?' to reset it.",
        )
    result = await db.execute(
        text("""UPDATE users SET password_hash = :h
                 WHERE id = :uid AND password_hash IS NULL"""),
        {"h": await hash_password_async(payload.new_password), "uid": user["id"]},
    )
    if result.rowcount == 0:
        # Lost the race: another setup call set the password between our SELECT
        # and UPDATE. Never overwrite an existing password here.
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This account already has a password. Use 'Forgot your password?' to reset it.",
        )
    await db.commit()
    logger.info("password setup completed tenant_id=%s user_id=%s", tenant["id"], user["id"])
    return {"status": "set", "message": "Password created. You can now sign in."}


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
    existing = await get_user_by_tenant_email(
        db, tenant_id, email, columns="id, is_active"
    )
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
    ``REFRESH_GRACE_SECONDS`` (48h, #228). That lets a session that lapsed (e.g. a 24h token
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
