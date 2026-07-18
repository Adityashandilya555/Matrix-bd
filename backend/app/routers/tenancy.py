"""Tenancy router.

Thin HTTP surface — validates payloads, enforces the platform-admin guard, and
shapes responses. All SQL and provisioning flows live in
`app.services.tenancy_service` (#378).

Surfaces:
- GET  /tenants                       — supervisor: list own tenants
- GET  /cities                        — authed:    distinct cities in own tenant
- GET  /workspace-info                — authed:    own tenant's code + seat usage
- POST /request-workspace             — PUBLIC:    capture a workspace request
- POST /requests/{id}/approve         — platform:  provision tenant + business_admin
- POST /join                          — PUBLIC:    employee self-join via workspace_code
"""
from __future__ import annotations

import logging
import re
import secrets
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field, field_validator

from app.core.config import settings
from app.core.deps import CurrentUser, DbDep, TenantId
from app.core.ratelimit import rate_limit
from app.core.security import decode_admin_token, issue_admin_token
from app.core.uploads import read_upload_capped
from app.rbac.guards import require_role
from app.rbac.roles import Role
from app.services import tenancy_service
from app.services.auth_repo import get_tenant_by_workspace_code
from app.services.storage_service import safe_object_name, signed_url
from app.services.storage_service import upload_bytes as storage_upload
# Re-exported so `_generate_workspace_code` / `_parse_seat_limit` stay importable
# from this module (existing tests import them from the router namespace).
from app.services.tenancy_service import _generate_workspace_code, _parse_seat_limit  # noqa: F401

logger = logging.getLogger("matrix.tenancy")

router = APIRouter(prefix="/tenancy", tags=["Tenancy"])

_EMAIL_RE       = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_WS_CODE_RE     = re.compile(r"^[A-Za-z0-9\-]{4,32}$")


# ── Helpers ───────────────────────────────────────────────────────────────


def _require_platform_admin(provided: Optional[str]) -> None:
    """Verify the X-Platform-Admin-Key header contains a valid admin JWT.

    Only short-lived JWTs issued by POST /admin/login are accepted (#312).
    The legacy static-token fallback has been removed (CodeAnt review —
    Critical): a leaked static password/token can no longer bypass the
    30-minute JWT expiry window.
    """
    if not provided:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Platform-Admin-Key header.",
        )
    try:
        decode_admin_token(provided)
    except Exception:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired admin token — please log in again.",
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
    dependencies=[Depends(rate_limit(times=10, seconds=300))],
)
async def admin_login(payload: AdminLoginIn) -> AdminLoginOut:
    expected_email    = (settings.platform_admin_email or "").strip().lower()
    expected_password = settings.effective_platform_admin_password or ""
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
    # Issue #312: mint a short-lived JWT instead of echoing the static
    # password/token back. The JWT expires in 30 min; the browser must
    # re-authenticate after that.
    token = issue_admin_token(email=expected_email)
    return AdminLoginOut(
        token=token,
        email=expected_email,
    )


# ── Existing reads ────────────────────────────────────────────────────────


@router.get("/tenants", summary="List tenants (supervisor only)")
async def list_tenants(
    db: DbDep,
    current_user: Annotated[dict, Depends(require_role(Role.SUPERVISOR))],
) -> dict:
    rows = await tenancy_service.list_tenants(db, current_user["tenant_id"])
    return {
        "items": [{"id": str(t.id), "name": t.name, "slug": t.slug, "plan": t.plan} for t in rows],
        "total": len(rows),
    }


@router.get("/cities", summary="List active cities in tenant")
async def list_cities(
    db: DbDep,
    _auth: CurrentUser,
    tenant_id: TenantId,
    limit: int = Query(200, le=500),
) -> dict:
    # Naturally bounded (distinct city names), but cap it so the response can't
    # grow without bound as a tenant's footprint expands (#95).
    rows = await tenancy_service.list_cities(db, tenant_id, limit=limit)
    return {"cities": rows}


# ── Workspace info (supervisor's "what's my code" call) ────────────────────


@router.get(
    "/workspace-info",
    summary="Authed: current tenant code + seat usage",
)
async def workspace_info(db: DbDep, _auth: CurrentUser, tenant_id: TenantId) -> dict:
    row = await tenancy_service.get_workspace_info(db, tenant_id)
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
    dependencies=[Depends(rate_limit(times=3, seconds=300))],
)
async def request_workspace(
    payload: WorkspaceRequestIn,
    request: Request,
    db: DbDep,
) -> WorkspaceRequestOut:
    source_ip  = request.client.host if request.client else None
    seat_limit = _parse_seat_limit(payload.team_size)
    try:
        row_id = await tenancy_service.insert_workspace_request(
            db,
            company=payload.company.strip(),
            admin_email=str(payload.admin_email),
            team_size=payload.team_size,
            seat_limit=seat_limit,
            source_ip=source_ip,
        )
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
    rows = await tenancy_service.list_workspace_requests(
        db, status_filter=status_filter, limit=limit,
    )
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
    await tenancy_service.reject_workspace_request(db, request_id)
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
    # One-time password-setup code for the provisioned admin (#83): accounts
    # ship with no password and cannot log in until one is set via
    # /auth/password-reset/complete with this token.
    admin_setup_token: str
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
    result = await tenancy_service.approve_workspace_request(
        db, request_id=request_id, admin_name=payload.admin_name, city=payload.city,
    )
    return ApproveOut(
        tenant_id=str(result["tenant_id"]),
        workspace_code=result["workspace_code"],
        seat_limit=result["seat_limit"],
        business_admin_id=str(result["business_admin_id"]),
        supervisor_id=str(result["business_admin_id"]),
        admin_setup_token=result["admin_setup_token"],
        message=(
            f"Provisioned {result['company']}. Share the workspace code {result['workspace_code']} "
            f"AND the one-time setup code with {result['admin_email']} — they set their "
            f"password on the login page ('Request a reset' → enter the setup code) "
            f"before first sign-in."
        ),
    )


# ── Public join: employee self-enrollment ──────────────────────────────────


class JoinIn(BaseModel):
    email:          str = Field(min_length=3, max_length=254)
    workspace_code: str = Field(min_length=4, max_length=32)
    password:       Optional[str] = Field(default=None, max_length=256)

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
    dependencies=[Depends(rate_limit(times=10, seconds=60))],
)
async def join_workspace(payload: JoinIn, db: DbDep) -> JoinOut:
    # IMPORTANT: same response for "no such code" and "already joined" so an
    # attacker can't enumerate workspace codes. The service logs the
    # discriminator server-side and raises 403 only on a full workspace.
    await tenancy_service.join_workspace(
        db, email=payload.email, workspace_code=payload.workspace_code, password=payload.password,
    )
    return JoinOut(
        status="pending_assignment",
        message=(
            "Request received. Once a supervisor assigns you a role you'll get "
            "an email with sign-in instructions."
        ),
    )


# ── Branding (customized login page) ────────────────────────────────────────

@router.get(
    "/branding",
    summary="Public: company name + logo for a workspace code (drives the branded login page)",
    dependencies=[Depends(rate_limit(times=30, seconds=60))],
)
async def public_branding(code: str, db: DbDep) -> dict:
    row = await get_tenant_by_workspace_code(db, code, columns="name, logo_url")
    if not row:
        # Default branding instead of a 404 — the status-code split made this
        # endpoint a valid-code enumeration oracle that also leaked company
        # names/logos for harvested codes (#84).
        return {"name": None, "logo_url": None}
    logo = row["logo_url"]
    # logo_url stores the storage object path; hand back a fresh signed URL so
    # the link never goes stale in the database.
    if logo and not logo.startswith("http"):
        try:
            logo = await signed_url(logo, expires_in=3600)
        except Exception as exc:
            logger.debug("public_branding: could not sign logo for code=%s: %s", code, exc)
            logo = None
    return {"name": row["name"], "logo_url": logo}


@router.post(
    "/tenants/{tenant_id}/branding",
    summary="Platform admin: set a tenant's display name + upload its login-page logo",
)
async def set_tenant_branding(
    tenant_id: str,
    db: DbDep,
    name: Optional[str] = Form(default=None),
    logo: Optional[UploadFile] = File(default=None),
    x_platform_admin_key: Optional[str] = Header(default=None, alias="X-Platform-Admin-Key"),
) -> dict:
    _require_platform_admin(x_platform_admin_key)

    tenant = await tenancy_service.get_tenant_for_branding(db, tenant_id)
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found.")

    # The SELECT above auto-began a read transaction on the session. Release it
    # BEFORE the (up-to-30s) storage upload so we don't hold a connection / scarce
    # pgBouncer slot across slow external I/O (#235; mirrors the #89 LOI/photo/
    # design fix). Only plain values are carried across the rollback; the UPDATE
    # below targets WHERE id = :id and does not depend on the released read. No
    # FOR UPDATE is needed — last-write-wins on branding metadata is acceptable.
    new_name = (name or "").strip() or tenant["name"]
    logo_path = tenant["logo_url"]
    await db.rollback()

    if logo is not None:
        body = await read_upload_capped(logo)
        if body:
            safe = safe_object_name(logo.filename or "logo.png")
            logo_path = f"branding/{tenant_id}/{safe}"
            await storage_upload(
                path=logo_path,
                body=body,
                content_type=logo.content_type or "image/png",
            )

    await tenancy_service.update_tenant_branding(
        db, tenant_id=tenant_id, name=new_name, logo=logo_path,
    )
    logger.info("branding set tenant_id=%s name=%r has_logo=%s", tenant_id, new_name, bool(logo_path))
    return {"id": str(tenant_id), "name": new_name, "has_logo": bool(logo_path)}


# ── Password-reset queue (platform admin) ────────────────────────────────────

@router.get(
    "/password-reset-requests",
    summary="Platform admin: list pending password-reset requests",
)
async def list_password_reset_requests(
    db: DbDep,
    x_platform_admin_key: Optional[str] = Header(default=None, alias="X-Platform-Admin-Key"),
) -> dict:
    _require_platform_admin(x_platform_admin_key)
    rows = await tenancy_service.list_pending_password_reset_requests(db)
    return {
        "items": [
            {
                "id":             str(x["id"]),
                "email":          x["email"],
                "tenant_name":    x["tenant_name"],
                "workspace_code": x["workspace_code"],
                "created_at":     x["created_at"].isoformat() if x["created_at"] else None,
            }
            for x in rows
        ],
        "total": len(rows),
    }


@router.post(
    "/password-reset-requests/{request_id}/confirm",
    summary="Platform admin: approve a reset request (the user then sets the new password)",
)
async def confirm_password_reset_request(
    request_id: str,
    db: DbDep,
    x_platform_admin_key: Optional[str] = Header(default=None, alias="X-Platform-Admin-Key"),
) -> dict:
    _require_platform_admin(x_platform_admin_key)
    reset_token = await tenancy_service.confirm_password_reset_request(db, request_id)
    return {"id": str(request_id), "status": "approved", "reset_token": reset_token}
