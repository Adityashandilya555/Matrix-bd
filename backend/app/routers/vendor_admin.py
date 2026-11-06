"""Vendor platform administration — Blue Tokai's side.

Business admin: settings, templates, vendor companies, codes, owner invites
and approvals (business-admin portal → Vendors). Project module: the vendor
project list and issuing a PO (Project → Vendor fit-out). A vendor token never
reaches this router: /vendor-admin is outside the vendor allow-list in
app/core/deps.py, and every route here also carries a Matrix role guard.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.core.deps import DbDep
from app.core.uploads import read_upload_capped
from app.domain.schemas.vendor import (
    ChecklistIn, OwnerInviteIn, PhasesIn, ProjectCreateIn, VendorCreateIn, VendorSettingsIn, VendorUpdateIn,
)
from app.rbac.guards import require_module, require_role
from app.rbac.roles import Role
from app.services import vendor_project_service as projects
from app.services import vendor_service as svc
from app.services.storage_service import safe_object_name, upload_bytes

router = APIRouter(prefix="/vendor-admin", tags=["Vendor admin"])

BusinessAdmin = Annotated[dict, Depends(require_role(Role.BUSINESS_ADMIN))]
# Project module members (business admin and observer pass through the
# READ_ALL bypass in require_role/require_module; observers cannot write).
ProjectTeam = Annotated[dict, Depends(require_role(Role.SUPERVISOR, Role.EXECUTIVE))]
InProjectModule = Annotated[dict, Depends(require_module("project"))]
ProjectSupervisor = Annotated[dict, Depends(require_role(Role.SUPERVISOR))]

_LOGO_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp"}


@router.get("/settings")
async def get_settings(user: BusinessAdmin, db: DbDep) -> dict:
    """The workspace's vendor settings."""
    return {"settings": await svc.settings_out(await svc.get_settings(db, user["tenant_id"]))}


@router.put("/settings")
async def put_settings(body: VendorSettingsIn, user: BusinessAdmin, db: DbDep) -> dict:
    """Save the workspace's vendor settings."""
    saved = await svc.update_settings(db, tenant_id=user["tenant_id"], actor=user, body=body.model_dump())
    return {"settings": await svc.settings_out(saved)}


@router.post("/settings/logo")
async def post_logo(user: BusinessAdmin, db: DbDep, file: UploadFile = File(...)) -> dict:  # noqa: B008 — FastAPI idiom
    """Upload the vendor portal logo (PNG, JPEG or WebP)."""
    if (file.content_type or "").lower() not in _LOGO_TYPES:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Use a PNG, JPEG or WebP image.")
    body = await read_upload_capped(file, max_bytes=2 * 1024 * 1024)
    path = f"vendor-branding/{user['tenant_id']}/{safe_object_name(file.filename or 'logo.png')}"
    await upload_bytes(path=path, body=body, content_type=file.content_type or "image/png")
    await svc.set_logo_path(db, tenant_id=user["tenant_id"], actor=user, path=path)
    return {"settings": await svc.settings_out(await svc.get_settings(db, user["tenant_id"]))}


@router.get("/templates/phases")
async def get_phases(user: BusinessAdmin, db: DbDep) -> dict:
    """Plan phases for both site types."""
    return {"phases": await svc.get_phases(db, user["tenant_id"])}


@router.put("/templates/phases")
async def put_phases(body: PhasesIn, user: BusinessAdmin, db: DbDep) -> dict:
    """Replace one site type's plan."""
    rows = await svc.save_phases(
        db, tenant_id=user["tenant_id"], actor=user, site_type=body.site_type,
        phases=[p.model_dump() for p in body.phases],
    )
    return {"phases": rows}


@router.get("/templates/checklists")
async def get_checklists(user: BusinessAdmin, db: DbDep) -> dict:
    """Mobilisation checklist items."""
    return {"items": await svc.get_checklist(db, user["tenant_id"])}


@router.put("/templates/checklists")
async def put_checklists(body: ChecklistIn, user: BusinessAdmin, db: DbDep) -> dict:
    """Save the mobilisation checklists."""
    return {"items": await svc.save_checklist(db, tenant_id=user["tenant_id"], actor=user, items=[i.model_dump() for i in body.items])}


@router.get("/vendors")
async def list_vendors(user: ProjectTeam, _m: InProjectModule, db: DbDep) -> dict:
    """Vendor companies (the Project team needs the list to issue a PO)."""
    return {"vendors": await svc.list_vendors(db, user["tenant_id"])}


@router.post("/vendors")
async def create_vendor(body: VendorCreateIn, user: BusinessAdmin, db: DbDep) -> dict:
    """Add a vendor company with fresh codes."""
    await svc.create_vendor(db, tenant_id=user["tenant_id"], actor=user, body=body.model_dump())
    return {"vendors": await svc.list_vendors(db, user["tenant_id"])}


@router.patch("/vendors/{vendor_id}")
async def update_vendor(vendor_id: str, body: VendorUpdateIn, user: BusinessAdmin, db: DbDep) -> dict:
    """Edit, suspend or reactivate a vendor company."""
    return await svc.update_vendor(db, tenant_id=user["tenant_id"], actor=user, vendor_id=vendor_id, body=body.model_dump())


@router.post("/vendors/{vendor_id}/codes/{kind}/rotate")
async def rotate_code(vendor_id: str, kind: str, user: BusinessAdmin, db: DbDep) -> dict:
    """Rotate a vendor's staff code (the only code kind; vendors sign in with the workspace code)."""
    return await svc.rotate_code(db, tenant_id=user["tenant_id"], actor=user, vendor_id=vendor_id, kind=kind)


@router.post("/vendors/{vendor_id}/invite-owner")
async def invite_owner(vendor_id: str, body: OwnerInviteIn, user: BusinessAdmin, db: DbDep) -> dict:
    """Create an owner account for a vendor."""
    return await svc.invite_owner(db, tenant_id=user["tenant_id"], actor=user, vendor_id=vendor_id, email=str(body.email), name=body.name)


@router.get("/pending")
async def list_pending(user: BusinessAdmin, db: DbDep) -> dict:
    """Everyone waiting to join a vendor workspace."""
    return {"pending": await svc.list_pending(db, user["tenant_id"])}


@router.post("/pending/{user_id}/approve")
async def approve_pending(user_id: str, user: BusinessAdmin, db: DbDep) -> dict:
    """Admit a vendor person the admission rule routes to the business admin."""
    return await svc.decide_pending(db, tenant_id=user["tenant_id"], actor=user, user_id=user_id, approve=True)


@router.post("/pending/{user_id}/reject")
async def reject_pending(user_id: str, user: BusinessAdmin, db: DbDep) -> dict:
    """Remove a pending vendor request."""
    return await svc.decide_pending(db, tenant_id=user["tenant_id"], actor=user, user_id=user_id, approve=False)


@router.get("/projects")
async def list_projects(user: ProjectTeam, _m: InProjectModule, db: DbDep) -> dict:
    """Every vendor project with live progress."""
    return {"projects": await projects.list_projects(db, user["tenant_id"])}


@router.post("/projects")
async def create_project(body: ProjectCreateIn, user: ProjectSupervisor, _m: InProjectModule, db: DbDep) -> dict:
    """Issue a PO to a vendor company (project supervisor or business admin)."""
    await projects.create_project(db, tenant_id=user["tenant_id"], actor=user, body=body.model_dump())
    return {"projects": await projects.list_projects(db, user["tenant_id"])}


@router.get("/projects/{project_id}")
async def get_project(project_id: str, user: ProjectTeam, _m: InProjectModule, db: DbDep) -> dict:
    """One vendor project with its daily-update log."""
    return await projects.project_detail_admin(db, user["tenant_id"], project_id)
