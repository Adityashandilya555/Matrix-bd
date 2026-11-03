"""Vendor platform — vendor companies, codes, admission and per-tenant settings.

Everything a workspace can customise about its vendor platform lives here:
the admission rule (who approves new vendor people), self-signup, the daily
update cutoff, programme durations, portal branding, plan phases and the
mobilisation checklists. Templates are seeded from the demo's values on a
tenant's first read, so a new workspace starts with a working plan.

Every query filters on tenant_id. Vendor-portal callers additionally pass the
vendor_id that app/core/deps.py read from vendor_users — never one from the
request.
"""
from __future__ import annotations

import re
import secrets
import uuid
from datetime import time
from typing import Any, Optional, Sequence
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import transaction
from app.domain.vendor_schedule import (
    DEFAULT_CHECKLIST, DEFAULT_NON_MALL_PHASES, Phase, scale_phases, validate_phases,
)
from app.services.audit_service import write_audit_event
from app.services.storage_service import signed_url

ADMISSION_MODES = ("owner_approves_staff", "admin_approves_all")
SITE_TYPES = ("mall", "non_mall")
CHECKLIST_KINDS = ("mobilisation_vendor", "mobilisation_brand")
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_DEFAULTS: dict[str, Any] = {
    "admission_mode": "owner_approves_staff", "allow_self_signup": False,
    "update_cutoff_local": time(19, 0), "timezone": "Asia/Kolkata",
    "mall_duration_days": 40, "non_mall_duration_days": 45,
    "portal_title": None, "accent_color": None, "welcome_text": None,
    "support_contact": None, "logo_path": None,
}


def new_vendor_code() -> str:
    """`VND-` + 64 random bits, the same entropy as a workspace code, so
    tenancy_service.is_full_entropy_code() is true for it."""
    return f"VND-{secrets.token_hex(8).upper()}"


def _not_found(what: str = "Vendor") -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{what} not found.")


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


# ── Settings ─────────────────────────────────────────────────────────────────

async def get_settings(session: AsyncSession, tenant_id: str | UUID) -> dict[str, Any]:
    """The tenant's vendor settings, with defaults for a tenant that has none."""
    row = (await session.execute(
        text("""
            SELECT admission_mode, allow_self_signup, update_cutoff_local, timezone,
                   mall_duration_days, non_mall_duration_days, portal_title, accent_color,
                   welcome_text, support_contact, logo_path
              FROM vendor_settings WHERE tenant_id = :tid
        """),
        {"tid": tenant_id},
    )).mappings().first()
    out = dict(_DEFAULTS)
    if row:
        out.update({k: row[k] for k in _DEFAULTS})
    return out


async def settings_out(settings: dict[str, Any]) -> dict[str, Any]:
    """Settings as the API returns them (time as HH:MM, a signed logo URL)."""
    cutoff = settings["update_cutoff_local"]
    logo = settings.get("logo_path")
    logo_url = None
    if logo:
        try:
            logo_url = await signed_url(logo, expires_in=3600)
        except Exception:  # noqa: BLE001 — a missing logo must not break the page
            logo_url = None
    return {
        **{k: settings[k] for k in _DEFAULTS if k not in ("update_cutoff_local", "logo_path")},
        "update_cutoff_local": cutoff.strftime("%H:%M") if isinstance(cutoff, time) else str(cutoff)[:5],
        "logo_url": logo_url,
    }


def clean_text(value: Any, limit: int) -> Optional[str]:
    """Trim a free-text field to `limit` characters; blank becomes None."""
    if value is None:
        return None
    s = str(value).strip()
    return s[:limit] or None


async def update_settings(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict, body: dict[str, Any],
) -> dict[str, Any]:
    """Validate and upsert the tenant's vendor settings."""
    mode = body.get("admission_mode")
    if mode not in ADMISSION_MODES:
        raise _unprocessable("Choose who approves new vendor people.")
    accent = body.get("accent_color")
    if accent and not _HEX.match(str(accent)):
        raise _unprocessable("The accent colour must be a hex value like #1D3F8C.")
    try:
        hh, mm = str(body.get("update_cutoff_local") or "19:00")[:5].split(":")
        cutoff = time(int(hh), int(mm))
    except (ValueError, TypeError):
        raise _unprocessable("The daily cutoff must be a time like 19:00.") from None
    durations = {}
    for key in ("mall_duration_days", "non_mall_duration_days"):
        try:
            durations[key] = int(body.get(key) or 0)
        except (TypeError, ValueError):
            raise _unprocessable("Programme durations must be whole numbers of days.") from None
        if not 5 <= durations[key] <= 365:
            raise _unprocessable("Programme durations must be between 5 and 365 days.")
    params = {
        "tid": tenant_id, "mode": mode, "self": bool(body.get("allow_self_signup")),
        "cutoff": cutoff, "tz": clean_text(body.get("timezone"), 64) or "Asia/Kolkata",
        "mall": durations["mall_duration_days"], "nonmall": durations["non_mall_duration_days"],
        "title": clean_text(body.get("portal_title"), 80), "accent": accent or None,
        "welcome": clean_text(body.get("welcome_text"), 500),
        "support": clean_text(body.get("support_contact"), 160), "uid": actor["sub"],
    }
    async with transaction(session):
        await session.execute(
            text("""
                INSERT INTO vendor_settings (tenant_id, admission_mode, allow_self_signup, update_cutoff_local,
                    timezone, mall_duration_days, non_mall_duration_days, portal_title, accent_color,
                    welcome_text, support_contact, updated_by, updated_at)
                VALUES (:tid, :mode, :self, :cutoff, :tz, :mall, :nonmall, :title, :accent, :welcome, :support, :uid, now())
                ON CONFLICT (tenant_id) DO UPDATE SET
                    admission_mode = EXCLUDED.admission_mode, allow_self_signup = EXCLUDED.allow_self_signup,
                    update_cutoff_local = EXCLUDED.update_cutoff_local, timezone = EXCLUDED.timezone,
                    mall_duration_days = EXCLUDED.mall_duration_days, non_mall_duration_days = EXCLUDED.non_mall_duration_days,
                    portal_title = EXCLUDED.portal_title, accent_color = EXCLUDED.accent_color,
                    welcome_text = EXCLUDED.welcome_text, support_contact = EXCLUDED.support_contact,
                    updated_by = EXCLUDED.updated_by, updated_at = now()
            """),
            params,
        )
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=None, actor_id=actor["sub"], actor_name=actor.get("name"),
            action="vendor_settings_updated", entity_type="vendor_settings", detail=f"admission_mode={mode}",
        )
    return await get_settings(session, tenant_id)


async def set_logo_path(session: AsyncSession, *, tenant_id: str | UUID, actor: dict, path: str) -> None:
    """Record the uploaded portal logo's storage path."""
    async with transaction(session):
        await session.execute(
            text("""
                INSERT INTO vendor_settings (tenant_id, logo_path, updated_by, updated_at)
                VALUES (:tid, :path, :uid, now())
                ON CONFLICT (tenant_id) DO UPDATE SET logo_path = EXCLUDED.logo_path,
                    updated_by = EXCLUDED.updated_by, updated_at = now()
            """),
            {"tid": tenant_id, "path": path, "uid": actor["sub"]},
        )
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=None, actor_id=actor["sub"], actor_name=actor.get("name"),
            action="vendor_logo_updated", entity_type="vendor_settings",
        )


# ── Templates: plan phases + mobilisation checklists ─────────────────────────

async def _seed_templates_if_empty(session: AsyncSession, tenant_id: str | UUID) -> None:
    """Give a tenant the demo's plan and checklists on first use."""
    have = (await session.execute(
        text("SELECT count(*) FROM vendor_plan_phases WHERE tenant_id = :tid"), {"tid": tenant_id},
    )).scalar() or 0
    if not have:
        plans = {"non_mall": list(DEFAULT_NON_MALL_PHASES), "mall": scale_phases(DEFAULT_NON_MALL_PHASES, 45, 40)}
        for site_type, rows in plans.items():
            for i, p in enumerate(rows):
                await session.execute(
                    text("""
                        INSERT INTO vendor_plan_phases (tenant_id, site_type, phase_key, name, start_day, end_day, weight, sort_order)
                        VALUES (:tid, :st, :k, :n, :s, :e, :w, :o)
                        ON CONFLICT (tenant_id, site_type, phase_key) DO NOTHING
                    """),
                    {"tid": tenant_id, "st": site_type, "k": p.key, "n": p.name, "s": p.start_day, "e": p.end_day, "w": p.weight, "o": i},
                )
    have_items = (await session.execute(
        text("SELECT count(*) FROM vendor_checklist_items WHERE tenant_id = :tid"), {"tid": tenant_id},
    )).scalar() or 0
    if not have_items:
        for i, (kind, label) in enumerate(DEFAULT_CHECKLIST):
            await session.execute(
                text("INSERT INTO vendor_checklist_items (tenant_id, kind, label, sort_order) VALUES (:tid, :k, :l, :o)"),
                {"tid": tenant_id, "k": kind, "l": label, "o": i},
            )


async def get_phases(session: AsyncSession, tenant_id: str | UUID, site_type: Optional[str] = None) -> list[dict]:
    """Plan phases for the tenant (all site types, or one), seeding on first read."""
    async with transaction(session):
        await _seed_templates_if_empty(session, tenant_id)
    rows = (await session.execute(
        text("""
            SELECT site_type, phase_key, name, start_day, end_day, weight, sort_order
              FROM vendor_plan_phases WHERE tenant_id = :tid
             ORDER BY site_type, sort_order, start_day
        """),
        {"tid": tenant_id},
    )).mappings().all()
    return [dict(r) for r in rows if site_type is None or r["site_type"] == site_type]


def phases_as_domain(rows: list[dict]) -> list[Phase]:
    """Template rows → domain Phase objects for vendor_schedule."""
    return [Phase(r["phase_key"], r["name"], int(r["start_day"]), int(r["end_day"]), int(r["weight"])) for r in rows]


async def save_phases(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict, site_type: str, phases: list[dict],
) -> list[dict]:
    """Replace one site type's plan after validating it against its duration."""
    if site_type not in SITE_TYPES:
        raise _unprocessable("Unknown site type.")
    settings = await get_settings(session, tenant_id)
    duration = settings["mall_duration_days" if site_type == "mall" else "non_mall_duration_days"]
    try:
        domain = [
            Phase(str(p.get("phase_key") or "").strip()[:24], str(p.get("name") or "").strip()[:80],
                  int(p.get("start_day") or 0), int(p.get("end_day") or 0), int(p.get("weight") or 0))
            for p in phases
        ]
    except (TypeError, ValueError):
        raise _unprocessable("Days and weights must be whole numbers.") from None
    if any(not p.key for p in domain):
        raise _unprocessable("Each phase needs a key.")
    problem = validate_phases(domain, duration)
    if problem:
        raise _unprocessable(problem)
    async with transaction(session):
        await session.execute(
            text("DELETE FROM vendor_plan_phases WHERE tenant_id = :tid AND site_type = :st"),
            {"tid": tenant_id, "st": site_type},
        )
        for i, p in enumerate(domain):
            await session.execute(
                text("""
                    INSERT INTO vendor_plan_phases (tenant_id, site_type, phase_key, name, start_day, end_day, weight, sort_order)
                    VALUES (:tid, :st, :k, :n, :s, :e, :w, :o)
                """),
                {"tid": tenant_id, "st": site_type, "k": p.key, "n": p.name, "s": p.start_day, "e": p.end_day, "w": p.weight, "o": i},
            )
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=None, actor_id=actor["sub"], actor_name=actor.get("name"),
            action="vendor_phases_updated", entity_type="vendor_plan_phases", detail=f"site_type={site_type}",
        )
    return await get_phases(session, tenant_id)


async def get_checklist(session: AsyncSession, tenant_id: str | UUID, *, active_only: bool = False) -> list[dict]:
    """Mobilisation checklist items, seeding on first read."""
    async with transaction(session):
        await _seed_templates_if_empty(session, tenant_id)
    rows = (await session.execute(
        text("""
            SELECT id, kind, label, sort_order, active FROM vendor_checklist_items
             WHERE tenant_id = :tid ORDER BY kind DESC, sort_order
        """),
        {"tid": tenant_id},
    )).mappings().all()
    return [{**dict(r), "id": str(r["id"])} for r in rows if r["active"] or not active_only]


async def save_checklist(session: AsyncSession, *, tenant_id: str | UUID, actor: dict, items: list[dict]) -> list[dict]:
    """Upsert checklist items. Items left out are deactivated, not deleted, so
    ticks already recorded on projects keep their history."""
    clean = []
    for i, it in enumerate(items):
        kind, label = it.get("kind"), str(it.get("label") or "").strip()[:200]
        if kind not in CHECKLIST_KINDS:
            raise _unprocessable("Unknown checklist kind.")
        if not label:
            raise _unprocessable("Every checklist item needs a label.")
        clean.append((str(it["id"]) if it.get("id") else None, kind, label, bool(it.get("active", True)), i))
    async with transaction(session):
        keep: list[str] = []
        for item_id, kind, label, active, order in clean:
            if item_id:
                res = await session.execute(
                    text("""
                        UPDATE vendor_checklist_items SET kind = :k, label = :l, active = :a, sort_order = :o
                         WHERE id = CAST(:id AS uuid) AND tenant_id = :tid
                    """),
                    {"k": kind, "l": label, "a": active, "o": order, "id": item_id, "tid": tenant_id},
                )
                if getattr(res, "rowcount", 0):
                    keep.append(item_id)
                    continue
            new_id = str(uuid.uuid4())
            await session.execute(
                text("""
                    INSERT INTO vendor_checklist_items (id, tenant_id, kind, label, active, sort_order)
                    VALUES (CAST(:id AS uuid), :tid, :k, :l, :a, :o)
                """),
                {"id": new_id, "tid": tenant_id, "k": kind, "l": label, "a": active, "o": order},
            )
            keep.append(new_id)
        await session.execute(
            text("""
                UPDATE vendor_checklist_items SET active = false
                 WHERE tenant_id = :tid AND NOT (CAST(id AS text) = ANY(:keep))
            """),
            {"tid": tenant_id, "keep": keep},
        )
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=None, actor_id=actor["sub"], actor_name=actor.get("name"),
            action="vendor_checklist_updated", entity_type="vendor_checklist_items",
        )
    return await get_checklist(session, tenant_id)


# ── Public branding for a vendor ENTRY code ─────────────────────────────────

async def public_vendor_branding(session: AsyncSession, code: str) -> Optional[dict]:
    """What /tenancy/branding shows for a live vendor entry code, or None."""
    row = (await session.execute(
        text("""
            SELECT vc.vendor_id, vc.tenant_id, v.name AS vendor_name, v.status AS vendor_status,
                   t.name AS tenant_name, s.logo_path, COALESCE(s.allow_self_signup, false) AS allow_self_signup,
                   EXISTS (SELECT 1 FROM vendor_codes sc WHERE sc.vendor_id = vc.vendor_id
                            AND sc.kind = 'staff' AND sc.revoked_at IS NULL) AS has_staff_code
              FROM vendor_codes vc
              JOIN vendors v ON v.id = vc.vendor_id
              JOIN tenants t ON t.id = vc.tenant_id
              LEFT JOIN vendor_settings s ON s.tenant_id = vc.tenant_id
             WHERE upper(vc.code) = upper(:code) AND vc.kind = 'entry' AND vc.revoked_at IS NULL
        """),
        {"code": code},
    )).mappings().first()
    if not row or row["vendor_status"] != "active":
        return None
    logo = None
    if row["logo_path"]:
        try:
            logo = await signed_url(row["logo_path"], expires_in=3600)
        except Exception:  # noqa: BLE001 — branding must render without a logo
            logo = None
    return {
        "found": True, "name": row["vendor_name"], "logo_url": logo, "platform": "vendor",
        "brand": row["tenant_name"], "join_allowed": bool(row["has_staff_code"] or row["allow_self_signup"]),
    }


# ── Vendor companies + codes ─────────────────────────────────────────────────

async def _live_codes(session: AsyncSession, tenant_id: str | UUID) -> dict[tuple[str, str], str]:
    rows = (await session.execute(
        text("SELECT vendor_id, kind, code FROM vendor_codes WHERE tenant_id = :tid AND revoked_at IS NULL"),
        {"tid": tenant_id},
    )).mappings().all()
    return {(str(r["vendor_id"]), r["kind"]): r["code"] for r in rows}


async def list_vendors(session: AsyncSession, tenant_id: str | UUID) -> list[dict]:
    """Every vendor company in the tenant, with codes and head-counts."""
    rows = (await session.execute(
        text("""
            SELECT v.id, v.name, v.legal_name, v.gstin, v.status, v.created_at,
                   (SELECT count(*) FROM vendor_users vu JOIN users u ON u.id = vu.user_id
                     WHERE vu.vendor_id = v.id AND u.is_active) AS user_count,
                   (SELECT count(*) FROM vendor_users vu JOIN users u ON u.id = vu.user_id
                     WHERE vu.vendor_id = v.id AND NOT u.is_active) AS pending_count,
                   (SELECT count(*) FROM vendor_projects p WHERE p.vendor_id = v.id) AS project_count
              FROM vendors v WHERE v.tenant_id = :tid ORDER BY v.name
        """),
        {"tid": tenant_id},
    )).mappings().all()
    codes = await _live_codes(session, tenant_id)
    return [{
        "id": str(r["id"]), "name": r["name"], "legal_name": r["legal_name"], "gstin": r["gstin"],
        "status": r["status"], "entry_code": codes.get((str(r["id"]), "entry")),
        "staff_code": codes.get((str(r["id"]), "staff")), "user_count": r["user_count"] or 0,
        "pending_count": r["pending_count"] or 0, "project_count": r["project_count"] or 0,
    } for r in rows]


async def _insert_code(session: AsyncSession, *, tenant_id, vendor_id, kind: str, actor_id) -> str:
    code = new_vendor_code()
    await session.execute(
        text("""
            INSERT INTO vendor_codes (tenant_id, vendor_id, kind, code, created_by)
            VALUES (:tid, :vid, :kind, :code, :uid)
        """),
        {"tid": tenant_id, "vid": vendor_id, "kind": kind, "code": code, "uid": actor_id},
    )
    return code


async def fetch_vendor(session: AsyncSession, tenant_id, vendor_id) -> dict:
    """A vendor of this tenant, or 404 (also for a malformed id)."""
    try:
        UUID(str(vendor_id))
    except ValueError:
        raise _not_found() from None
    row = (await session.execute(
        text("SELECT id, name, status FROM vendors WHERE id = CAST(:vid AS uuid) AND tenant_id = :tid"),
        {"vid": str(vendor_id), "tid": tenant_id},
    )).mappings().first()
    if not row:
        raise _not_found()
    return dict(row)


async def _create_owner(session: AsyncSession, *, tenant_id, vendor_id, email: str, name: Optional[str], actor: dict) -> None:
    """An approved owner account with no password yet; they set one at first sign-in."""
    email = email.strip().lower()
    exists = (await session.execute(
        text("SELECT 1 FROM users WHERE tenant_id = :tid AND lower(email) = lower(:email)"),
        {"tid": tenant_id, "email": email},
    )).first()
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="That email already has an account in this workspace.")
    user_id = uuid.uuid4()
    await session.execute(
        text("""
            INSERT INTO users (id, tenant_id, role, email, name, is_active)
            VALUES (:id, :tid, 'vendor', :email, :name, true)
        """),
        {"id": user_id, "tid": tenant_id, "email": email, "name": (name or email.split("@")[0])[:120]},
    )
    await session.execute(
        text("""
            INSERT INTO vendor_users (user_id, tenant_id, vendor_id, vendor_role, approved_by, approved_at)
            VALUES (:uid, :tid, :vid, 'owner', :by, now())
        """),
        {"uid": user_id, "tid": tenant_id, "vid": vendor_id, "by": actor["sub"]},
    )


async def create_vendor(session: AsyncSession, *, tenant_id: str | UUID, actor: dict, body: dict) -> dict:
    """Add a vendor company with fresh entry and staff codes (and optionally its owner)."""
    name = clean_text(body.get("name"), 120)
    if not name:
        raise _unprocessable("Enter the vendor company name.")
    owner = clean_text(body.get("owner_email"), 254)
    if owner and "@" not in owner:
        raise _unprocessable("The owner email looks invalid.")
    vendor_id = uuid.uuid4()
    async with transaction(session):
        await session.execute(
            text("""
                INSERT INTO vendors (id, tenant_id, name, legal_name, gstin, created_by)
                VALUES (:id, :tid, :name, :legal, :gstin, :uid)
            """),
            {"id": vendor_id, "tid": tenant_id, "name": name, "legal": clean_text(body.get("legal_name"), 160),
             "gstin": clean_text(body.get("gstin"), 20), "uid": actor["sub"]},
        )
        await _insert_code(session, tenant_id=tenant_id, vendor_id=vendor_id, kind="entry", actor_id=actor["sub"])
        await _insert_code(session, tenant_id=tenant_id, vendor_id=vendor_id, kind="staff", actor_id=actor["sub"])
        if owner:
            await _create_owner(session, tenant_id=tenant_id, vendor_id=vendor_id, email=owner, name=None, actor=actor)
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=None, actor_id=actor["sub"], actor_name=actor.get("name"),
            action="vendor_created", entity_type="vendor", entity_id=vendor_id, detail=name,
        )
    return {"id": str(vendor_id)}


async def update_vendor(session: AsyncSession, *, tenant_id: str | UUID, actor: dict, vendor_id: str, body: dict) -> dict:
    """Edit a vendor's details or suspend/reactivate it. Suspension blocks
    sign-in and joining on the next request (app/core/deps.py)."""
    current = await fetch_vendor(session, tenant_id, vendor_id)
    new_status = body.get("status") or current["status"]
    if new_status not in ("active", "suspended"):
        raise _unprocessable("Unknown vendor status.")
    async with transaction(session):
        await session.execute(
            text("""
                UPDATE vendors SET name = COALESCE(:name, name), legal_name = :legal, gstin = :gstin,
                       status = :status, updated_at = now()
                 WHERE id = CAST(:vid AS uuid) AND tenant_id = :tid
            """),
            {"name": clean_text(body.get("name"), 120), "legal": clean_text(body.get("legal_name"), 160),
             "gstin": clean_text(body.get("gstin"), 20), "status": new_status, "vid": str(vendor_id), "tid": tenant_id},
        )
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=None, actor_id=actor["sub"], actor_name=actor.get("name"),
            action="vendor_updated", entity_type="vendor", entity_id=vendor_id,
            from_value=current["status"], to_value=new_status,
        )
    return {"ok": True}


async def rotate_code(session: AsyncSession, *, tenant_id: str | UUID, actor: dict, vendor_id: str, kind: str) -> dict:
    """Revoke the live entry/staff code and mint a new one. Existing accounts
    are unaffected; the old code simply stops working."""
    if kind not in ("entry", "staff"):
        raise _not_found("Code")
    await fetch_vendor(session, tenant_id, vendor_id)
    async with transaction(session):
        await session.execute(
            text("""
                UPDATE vendor_codes SET revoked_at = now()
                 WHERE vendor_id = CAST(:vid AS uuid) AND tenant_id = :tid AND kind = :kind AND revoked_at IS NULL
            """),
            {"vid": str(vendor_id), "tid": tenant_id, "kind": kind},
        )
        code = await _insert_code(session, tenant_id=tenant_id, vendor_id=vendor_id, kind=kind, actor_id=actor["sub"])
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=None, actor_id=actor["sub"], actor_name=actor.get("name"),
            action=f"vendor_{kind}_code_rotated", entity_type="vendor", entity_id=vendor_id,
        )
    return {"code": code}


async def invite_owner(session: AsyncSession, *, tenant_id: str | UUID, actor: dict, vendor_id: str, email: str, name: Optional[str]) -> dict:
    """Create a vendor owner account directly (no approval step)."""
    if not email or "@" not in email:
        raise _unprocessable("Enter a valid email.")
    await fetch_vendor(session, tenant_id, vendor_id)
    async with transaction(session):
        await _create_owner(session, tenant_id=tenant_id, vendor_id=vendor_id, email=email, name=name, actor=actor)
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=None, actor_id=actor["sub"], actor_name=actor.get("name"),
            action="vendor_owner_invited", entity_type="vendor", entity_id=vendor_id,
        )
    return {"ok": True}


# ── Admission ────────────────────────────────────────────────────────────────

def approver_for(mode: str, vendor_role: str) -> str:
    """Who decides a pending vendor person: 'admin' or 'owner'. Owners are
    always admitted by the business admin; staff follow the admission mode."""
    if vendor_role == "owner" or mode == "admin_approves_all":
        return "admin"
    return "owner"


async def _pending_rows(session: AsyncSession, tenant_id, vendor_id: Optional[str] = None) -> Sequence[Any]:
    return (await session.execute(
        text("""
            SELECT u.id, u.email, u.created_at, vu.vendor_id, vu.vendor_role, v.name AS vendor_name
              FROM users u
              JOIN vendor_users vu ON vu.user_id = u.id
              JOIN vendors v ON v.id = vu.vendor_id
             WHERE u.tenant_id = :tid AND u.role = 'vendor' AND u.is_active = false
               AND (CAST(:vid AS text) IS NULL OR CAST(vu.vendor_id AS text) = CAST(:vid AS text))
             ORDER BY u.created_at
        """),
        {"tid": tenant_id, "vid": vendor_id},
    )).mappings().all()


async def list_pending(session: AsyncSession, tenant_id: str | UUID) -> list[dict]:
    """Everyone waiting to join any vendor workspace, with who decides."""
    mode = (await get_settings(session, tenant_id))["admission_mode"]
    return [{
        "id": str(r["id"]), "email": r["email"], "created_at": r["created_at"], "vendor_id": str(r["vendor_id"]),
        "vendor_name": r["vendor_name"], "vendor_role": r["vendor_role"], "approver": approver_for(mode, r["vendor_role"]),
    } for r in await _pending_rows(session, tenant_id)]


async def decide_pending(
    session: AsyncSession, *, tenant_id: str | UUID, actor: dict, user_id: str, approve: bool,
    as_owner_of: Optional[str] = None,
) -> dict:
    """Approve or reject a pending vendor person.

    ``as_owner_of`` is set when a vendor OWNER decides: then the person must be
    in that owner's company and the admission mode must let owners decide.
    Otherwise the caller is the business admin, who decides whenever the mode
    (or the person being an owner) routes it to them.
    """
    try:
        UUID(str(user_id))
    except ValueError:
        raise _not_found("Request") from None
    mode = (await get_settings(session, tenant_id))["admission_mode"]
    async with transaction(session):
        row = (await session.execute(
            text("""
                SELECT u.id, u.email, vu.vendor_id, vu.vendor_role
                  FROM users u JOIN vendor_users vu ON vu.user_id = u.id
                 WHERE u.id = CAST(:uid AS uuid) AND u.tenant_id = :tid AND u.role = 'vendor' AND u.is_active = false
                 FOR UPDATE OF u
            """),
            {"uid": str(user_id), "tid": tenant_id},
        )).mappings().first()
        if not row:
            raise _not_found("Request")
        who = approver_for(mode, row["vendor_role"])
        if as_owner_of is not None:
            if str(row["vendor_id"]) != str(as_owner_of):
                raise _not_found("Request")
            if who != "owner":
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your client approves new staff for this workspace.")
        elif who != "admin":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="The vendor owner approves this workspace's staff.")
        if approve:
            await session.execute(
                text("UPDATE users SET is_active = true, notes = NULL WHERE id = CAST(:uid AS uuid) AND tenant_id = :tid"),
                {"uid": str(user_id), "tid": tenant_id},
            )
            await session.execute(
                text("UPDATE vendor_users SET approved_by = :by, approved_at = now() WHERE user_id = CAST(:uid AS uuid)"),
                {"by": actor["sub"], "uid": str(user_id)},
            )
        else:
            # Only ever an inactive, never-approved row (guarded above), like
            # business_admin_service.reject_observer.
            await session.execute(
                text("DELETE FROM users WHERE id = CAST(:uid AS uuid) AND tenant_id = :tid AND is_active = false"),
                {"uid": str(user_id), "tid": tenant_id},
            )
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=None, actor_id=actor["sub"], actor_name=actor.get("name"),
            action="vendor_user_approved" if approve else "vendor_user_rejected", entity_type="user",
            entity_id=user_id, detail=f"vendor_id={row['vendor_id']}",
        )
    return {"ok": True}


async def owner_staff_view(session: AsyncSession, *, tenant_id: str | UUID, vendor_id: str) -> dict:
    """The vendor owner's Team page: staff code, waiting people, active team."""
    mode = (await get_settings(session, tenant_id))["admission_mode"]
    staff = (await session.execute(
        text("""
            SELECT u.id, u.email, u.name, vu.vendor_role, vu.approved_at
              FROM users u JOIN vendor_users vu ON vu.user_id = u.id
             WHERE u.tenant_id = :tid AND vu.vendor_id = CAST(:vid AS uuid) AND u.is_active = true
             ORDER BY vu.vendor_role, u.email
        """),
        {"tid": tenant_id, "vid": vendor_id},
    )).mappings().all()
    codes = await _live_codes(session, tenant_id)
    return {
        "staff": [{**dict(r), "id": str(r["id"])} for r in staff],
        "pending": [{"id": str(r["id"]), "email": r["email"], "created_at": r["created_at"]}
                    for r in await _pending_rows(session, tenant_id, vendor_id)],
        "staff_code": codes.get((str(vendor_id), "staff")),
        "can_approve": mode == "owner_approves_staff",
    }


async def owner_rotate_staff_code(session: AsyncSession, *, tenant_id: str | UUID, actor: dict, vendor_id: str) -> dict:
    """A vendor owner rotating their own company's staff code."""
    return await rotate_code(session, tenant_id=tenant_id, actor=actor, vendor_id=vendor_id, kind="staff")
