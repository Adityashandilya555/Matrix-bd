"""Vendor portal API — the outside fit-out vendor's own surface (/vendor).

Every route requires the REAL role 'vendor' (require_real_role: no
business_admin/observer bypass, no override header) and is scoped to the
vendor_id app/core/deps.py read from vendor_users on this request — never an
id from the URL or body. Another vendor's project is a 404.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text

from app.core.deps import DbDep
from app.domain.schemas.vendor import AcceptPoIn, DailyUpdateIn, InitiationIn
from app.rbac.guards import require_real_role
from app.rbac.roles import Role
from app.services import vendor_project_service as projects
from app.services import vendor_service as svc

router = APIRouter(prefix="/vendor", tags=["Vendor portal"])

VendorUser = Annotated[dict, Depends(require_real_role(Role.VENDOR))]


def _vendor_id(user: dict) -> str:
    vid = user.get("vendor_id")
    if not vid:
        # Unreachable in practice: deps.py refuses a vendor without a live link.
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your vendor account is not linked to a company.")
    return vid


def _owner(user: dict) -> str:
    if user.get("vendor_role") != "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the vendor owner manages the team.")
    return _vendor_id(user)


@router.get("/me")
async def me(user: VendorUser, db: DbDep) -> dict:
    """The signed-in vendor user, their company and the portal branding."""
    vid = _vendor_id(user)
    row = (await db.execute(
        text("""
            SELECT v.id, v.name, v.status, t.name AS tenant_name
              FROM vendors v JOIN tenants t ON t.id = v.tenant_id
             WHERE v.id = CAST(:vid AS uuid) AND v.tenant_id = :tid
        """),
        {"vid": vid, "tid": user["tenant_id"]},
    )).mappings().first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vendor not found.")
    s = await svc.settings_out(await svc.get_settings(db, user["tenant_id"]))
    return {
        "user": {"id": user["sub"], "email": user.get("email"), "name": user.get("name"), "vendor_role": user.get("vendor_role")},
        "vendor": {"id": str(row["id"]), "name": row["name"], "status": row["status"]},
        "brand": {
            "tenant_name": row["tenant_name"], "portal_title": s["portal_title"], "accent_color": s["accent_color"],
            "welcome_text": s["welcome_text"], "support_contact": s["support_contact"], "logo_url": s["logo_url"],
        },
    }


@router.get("/home")
async def home(user: VendorUser, db: DbDep) -> dict:
    """KPIs, alerts and allocated sites."""
    return await projects.vendor_home(db, tenant_id=user["tenant_id"], vendor_id=_vendor_id(user))


@router.get("/projects/{project_id}")
async def project(project_id: str, user: VendorUser, db: DbDep) -> dict:
    """One allocated site."""
    return await projects.vendor_project_detail(db, tenant_id=user["tenant_id"], vendor_id=_vendor_id(user), project_id=project_id)


@router.post("/projects/{project_id}/accept")
async def accept(project_id: str, body: AcceptPoIn, user: VendorUser, db: DbDep) -> dict:
    """Accept the PO and confirm the start date."""
    return await projects.accept_po(db, tenant_id=user["tenant_id"], actor=user, vendor_id=_vendor_id(user),
                                    project_id=project_id, start_date=body.start_date)


@router.put("/projects/{project_id}/initiation")
async def initiation(project_id: str, body: InitiationIn, user: VendorUser, db: DbDep) -> dict:
    """Supervisor, crew, delivery plan and the vendor's checklist."""
    return await projects.save_initiation(db, tenant_id=user["tenant_id"], actor=user, vendor_id=_vendor_id(user),
                                          project_id=project_id, body=body.model_dump())


@router.get("/projects/{project_id}/updates")
async def updates(project_id: str, user: VendorUser, db: DbDep) -> dict:
    """The daily-update log."""
    return await projects.vendor_update_log(db, tenant_id=user["tenant_id"], vendor_id=_vendor_id(user), project_id=project_id)


@router.put("/projects/{project_id}/updates/today")
async def submit_today(project_id: str, body: DailyUpdateIn, user: VendorUser, db: DbDep) -> dict:
    """Submit or edit today's update."""
    return await projects.submit_today(db, tenant_id=user["tenant_id"], actor=user, vendor_id=_vendor_id(user),
                                       project_id=project_id, body=body.model_dump())


@router.get("/staff")
async def staff(user: VendorUser, db: DbDep) -> dict:
    """The owner's Team page."""
    return await svc.owner_staff_view(db, tenant_id=user["tenant_id"], vendor_id=_owner(user))


@router.post("/staff/code/rotate")
async def rotate_staff_code(user: VendorUser, db: DbDep) -> dict:
    """Rotate the company's staff code."""
    return await svc.owner_rotate_staff_code(db, tenant_id=user["tenant_id"], actor=user, vendor_id=_owner(user))


@router.post("/staff/pending/{user_id}/approve")
async def approve_staff(user_id: str, user: VendorUser, db: DbDep) -> dict:
    """Owner admits a staff member (when the admission rule lets owners decide)."""
    return await svc.decide_pending(db, tenant_id=user["tenant_id"], actor=user, user_id=user_id, approve=True, as_owner_of=_owner(user))


@router.post("/staff/pending/{user_id}/reject")
async def reject_staff(user_id: str, user: VendorUser, db: DbDep) -> dict:
    """Owner removes a staff request."""
    return await svc.decide_pending(db, tenant_id=user["tenant_id"], actor=user, user_id=user_id, approve=False, as_owner_of=_owner(user))
