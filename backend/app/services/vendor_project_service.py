"""Vendor platform — fit-out projects (POs to a vendor) and daily updates.

Blue Tokai's Project team issues a PO to a vendor company; the vendor accepts
it, fills in the initiation details and files a daily update with per-phase
progress. Every progress, status and forecast figure is computed here from the
tenant's plan template (app/domain/vendor_schedule.py), never in the browser.

Vendor callers are scoped by the vendor_id app/core/deps.py read from
vendor_users; a project of another vendor is a 404, never a 403, so its
existence is not confirmed.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from typing import Any, Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import transaction
from app.domain.vendor_schedule import (
    compute, is_past_cutoff, overall_pct, planned_fraction, planned_pct,
)
from app.services import vendor_service
from app.services.audit_service import write_audit_event

_PROJECT_COLUMNS = """
    p.id, p.vendor_id, v.name AS vendor_name, p.site_id, p.ca_code, p.name, p.city, p.brand,
    p.site_type, p.po_number, p.po_value, p.po_date, p.start_date, p.accepted_at, p.supervisor_name,
    p.supervisor_phone, p.crew_size, p.delivery_plan, p.status, p.handed_over_on
"""


def _now_local(settings: dict) -> datetime:
    try:
        return datetime.now(ZoneInfo(settings.get("timezone") or "Asia/Kolkata"))
    except Exception:  # noqa: BLE001 — a bad zone name falls back, never breaks
        return datetime.now(ZoneInfo("Asia/Kolkata"))


def _duration(settings: dict, site_type: str) -> int:
    return int(settings["mall_duration_days" if site_type == "mall" else "non_mall_duration_days"])


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found.")


async def _project_rows(session: AsyncSession, tenant_id, *, vendor_id: Optional[str] = None,
                        project_id: Optional[str] = None) -> list:
    if project_id is not None:
        try:
            UUID(str(project_id))
        except ValueError:
            return []
    # _PROJECT_COLUMNS is a module constant, never request data.
    return (await session.execute(
        text(f"""
            SELECT {_PROJECT_COLUMNS}
              FROM vendor_projects p JOIN vendors v ON v.id = p.vendor_id
             WHERE p.tenant_id = :tid
               AND (CAST(:vid AS text) IS NULL OR CAST(p.vendor_id AS text) = CAST(:vid AS text))
               AND (CAST(:pid AS text) IS NULL OR CAST(p.id AS text) = CAST(:pid AS text))
             ORDER BY p.start_date DESC, p.created_at DESC
        """),  # skipcq: BAN-B608
        {"tid": tenant_id, "vid": vendor_id, "pid": project_id},
    )).mappings().all()


async def _updates_for(session: AsyncSession, project_ids: list) -> dict[str, list[dict]]:
    """Daily updates (with per-phase progress) grouped by project, oldest first."""
    if not project_ids:
        return {}
    rows = (await session.execute(
        text("""
            SELECT d.id, d.project_id, d.report_date, d.day_no, d.manpower, d.supervisor_on_site, d.ppe_ok,
                   d.material, d.note, d.hindrance_text, d.submitted_at, d.submitted_late,
                   g.phase_key, g.percent
              FROM vendor_daily_updates d
              LEFT JOIN vendor_update_progress g ON g.update_id = d.id
             WHERE CAST(d.project_id AS text) = ANY(:ids)
             ORDER BY d.report_date, d.id
        """),
        {"ids": [str(i) for i in project_ids]},
    )).mappings().all()
    out: dict[str, dict[str, dict]] = {}
    for r in rows:
        per = out.setdefault(str(r["project_id"]), {})
        u = per.setdefault(str(r["id"]), {k: r[k] for k in r.keys() if k not in ("phase_key", "percent")} | {"progress": {}})
        if r["phase_key"] is not None:
            u["progress"][r["phase_key"]] = int(r["percent"])
    return {pid: list(v.values()) for pid, v in out.items()}


class _Ctx:
    """Settings, phases and 'now' resolved once per request for a tenant."""

    def __init__(self, settings: dict, phases_by_type: dict[str, list], now_local: datetime):
        self.settings = settings
        self.phases_by_type = phases_by_type
        self.now = now_local
        self.today = now_local.date()
        self.past_cutoff = is_past_cutoff(now_local, settings["update_cutoff_local"])


async def _ctx(session: AsyncSession, tenant_id) -> _Ctx:
    settings = await vendor_service.get_settings(session, tenant_id)
    rows = await vendor_service.get_phases(session, tenant_id)
    by_type = {
        t: vendor_service.phases_as_domain([r for r in rows if r["site_type"] == t]) for t in vendor_service.SITE_TYPES
    }
    return _Ctx(settings, by_type, _now_local(settings))


def _schedule(ctx: _Ctx, p: Any, ups: list[dict]):
    phases = ctx.phases_by_type[p["site_type"]]
    duration = _duration(ctx.settings, p["site_type"])
    latest = ups[-1]["progress"] if ups else {}
    return phases, duration, compute(
        phases=phases, duration=duration, start_date=p["start_date"], today=ctx.today,
        accepted=p["accepted_at"] is not None, handed_over_on=p["handed_over_on"],
        cancelled=p["status"] == "cancelled", latest_progress=latest,
        update_dates={u["report_date"] for u in ups}, past_cutoff=ctx.past_cutoff,
    )


def _summary(ctx: _Ctx, p: Any, ups: list[dict]) -> dict:
    _, _, s = _schedule(ctx, p, ups)
    return {
        "id": str(p["id"]), "vendor_id": str(p["vendor_id"]), "vendor_name": p["vendor_name"],
        "ca_code": p["ca_code"], "name": p["name"], "city": p["city"], "brand": p["brand"],
        "site_type": p["site_type"], "po_number": p["po_number"], "po_value": float(p["po_value"]),
        "start_date": p["start_date"], "status": p["status"], "schedule_status": s.schedule_status,
        "day": s.day, "duration": s.duration, "actual_pct": s.actual_pct, "planned_pct": s.planned_pct,
        "slip_days": s.slip_days, "target_date": s.target_date, "updated_today": s.updated_today,
        "missed": s.missed_in_row, "last_update": ups[-1]["report_date"] if ups else None,
    }


def _log_entries(ctx: _Ctx, p: Any, ups: list[dict], phases, duration: int) -> dict:
    by_date = {u["report_date"]: u for u in ups}
    entries: list[dict] = []
    start: date = p["start_date"]
    day = (ctx.today - start).days + 1
    if day >= 1:
        end = start + timedelta(days=duration - 1) if p["handed_over_on"] else ctx.today
        d, n = end, 0
        while d >= start and n < 60:
            dn = (d - start).days + 1
            u = by_date.get(d)
            if u:
                entries.append({**u, "id": str(u["id"]), "project_id": str(u["project_id"]),
                                "actual_pct": round(overall_pct(phases, u["progress"]), 2),
                                "planned_pct": round(planned_pct(phases, min(dn, duration)), 2), "missed": False})
            elif d != ctx.today or ctx.past_cutoff:
                entries.append({"report_date": d, "day_no": dn, "missed": True})
            d -= timedelta(days=1)
            n += 1
    updated_today = ctx.today in by_date
    expected = duration if p["handed_over_on"] else max(0, min(day if updated_today else day - 1, duration))
    return {"entries": entries, "expected_days": expected,
            "submitted_days": sum(1 for u in ups if u["day_no"] <= expected)}


async def _checklist_for(session: AsyncSession, tenant_id, project_id) -> list[dict]:
    items = await vendor_service.get_checklist(session, tenant_id, active_only=True)
    ticks = (await session.execute(
        text("SELECT item_id, checked FROM vendor_project_checks WHERE project_id = CAST(:pid AS uuid)"),
        {"pid": str(project_id)},
    )).mappings().all()
    done = {str(t["item_id"]): bool(t["checked"]) for t in ticks}
    return [{"item_id": it["id"], "kind": it["kind"], "label": it["label"], "checked": done.get(it["id"], False)} for it in items]


async def _detail(session: AsyncSession, ctx: _Ctx, tenant_id, p: Any, ups: list[dict]) -> dict:
    phases, duration, s = _schedule(ctx, p, ups)
    latest = ups[-1]["progress"] if ups else {}
    today_up = ups[-1] if ups and ups[-1]["report_date"] == ctx.today else None
    return {
        **_summary(ctx, p, ups),
        "po_date": p["po_date"], "accepted_at": p["accepted_at"], "accept_by": p["po_date"] + timedelta(days=2),
        "forecast_date": s.forecast_date, "days_past_target": s.days_past_target,
        "supervisor_name": p["supervisor_name"], "supervisor_phone": p["supervisor_phone"],
        "crew_size": p["crew_size"], "delivery_plan": p["delivery_plan"],
        "phases": [{"phase_key": ph.key, "name": ph.name, "start_day": ph.start_day, "end_day": ph.end_day,
                    "weight": ph.weight, "planned_pct": round(planned_fraction(ph, s.ref_day) * 100, 2),
                    "actual_pct": float(latest.get(ph.key, 0) or 0)} for ph in phases],
        "checklist": await _checklist_for(session, tenant_id, p["id"]),
        "curve": {
            "planned": [[d, round(planned_pct(phases, d), 2)] for d in range(duration + 1)],
            "actual": [[0, 0]] + [[u["day_no"], round(overall_pct(phases, u["progress"]), 2)] for u in ups if u["day_no"] <= duration],
        },
        "updates_open": p["accepted_at"] is not None and s.day >= 1 and p["status"] == "active",
        "past_cutoff": ctx.past_cutoff,
        "cutoff_local": ctx.settings["update_cutoff_local"].strftime("%H:%M"),
        "today": ({**today_up, "id": str(today_up["id"]), "project_id": str(today_up["project_id"])} if today_up else None),
        "last_progress": latest,
    }


# ── Blue Tokai side (Project module + business admin) ────────────────────────

async def list_projects(session: AsyncSession, tenant_id: str | UUID) -> list[dict]:
    """Every vendor project in the tenant, with live progress."""
    ctx = await _ctx(session, tenant_id)
    rows = await _project_rows(session, tenant_id)
    ups = await _updates_for(session, [r["id"] for r in rows])
    return [_summary(ctx, r, ups.get(str(r["id"]), [])) for r in rows]


async def project_detail_admin(session: AsyncSession, tenant_id: str | UUID, project_id: str) -> dict:
    """One project for the Project team, with its daily-update log."""
    rows = await _project_rows(session, tenant_id, project_id=project_id)
    if not rows:
        raise _not_found()
    p = rows[0]
    ctx = await _ctx(session, tenant_id)
    ups = (await _updates_for(session, [p["id"]])).get(str(p["id"]), [])
    phases, duration, _ = _schedule(ctx, p, ups)
    out = await _detail(session, ctx, tenant_id, p, ups)
    out["updates"] = [e for e in _log_entries(ctx, p, ups, phases, duration)["entries"] if not e["missed"]]
    return out


def _date_or_422(value: Any, label: str) -> date:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{label} must be a date.") from None


async def create_project(session: AsyncSession, *, tenant_id: str | UUID, actor: dict, body: dict) -> dict:
    """Issue a PO to an active vendor company."""
    vendor = await vendor_service.fetch_vendor(session, tenant_id, body.get("vendor_id"))
    if vendor["status"] != "active":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Pick an active vendor.")
    name = vendor_service.clean_text(body.get("name"), 160)
    city = vendor_service.clean_text(body.get("city"), 80)
    po_number = vendor_service.clean_text(body.get("po_number"), 60)
    try:
        po_value = float(body.get("po_value") or 0)
    except (TypeError, ValueError):
        po_value = 0
    if not (name and city and po_number) or po_value <= 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="Site name, city, PO number and a PO value above zero are required.")
    po_date = _date_or_422(body.get("po_date"), "PO date")
    start = _date_or_422(body.get("start_date"), "Start date")
    if start < po_date:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The start date cannot be before the PO date.")
    site_type = body.get("site_type") if body.get("site_type") in vendor_service.SITE_TYPES else "non_mall"
    site_id = body.get("site_id") or None
    if site_id:
        exists = (await session.execute(
            text("SELECT 1 FROM sites WHERE id = CAST(:sid AS uuid) AND tenant_id = :tid"), {"sid": str(site_id), "tid": tenant_id},
        )).first()
        if not exists:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="That Matrix site is not in this workspace.")
    project_id = uuid.uuid4()
    async with transaction(session):
        await session.execute(
            text("""
                INSERT INTO vendor_projects (id, tenant_id, vendor_id, site_id, ca_code, name, city, brand, site_type,
                    po_number, po_value, po_date, start_date, created_by)
                VALUES (:id, :tid, CAST(:vid AS uuid), CAST(:sid AS uuid), :ca, :name, :city, :brand, :st,
                    :po, :val, :pod, :start, :uid)
            """),
            {"id": project_id, "tid": tenant_id, "vid": str(vendor["id"]), "sid": str(site_id) if site_id else None,
             "ca": vendor_service.clean_text(body.get("ca_code"), 40), "name": name, "city": city,
             "brand": vendor_service.clean_text(body.get("brand"), 80), "st": site_type, "po": po_number,
             "val": po_value, "pod": po_date, "start": start, "uid": actor["sub"]},
        )
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site_id, actor_id=actor["sub"], actor_name=actor.get("name"),
            action="vendor_po_issued", entity_type="vendor_project", entity_id=project_id,
            detail=f"{po_number} to {vendor['name']}",
        )
    return {"id": str(project_id)}


# ── Vendor portal ────────────────────────────────────────────────────────────

def _home_alert(p: dict, *, past_cutoff: bool, cutoff: str) -> Optional[dict]:
    """The one to-do a site shows on the vendor home, if any."""
    label = f"{p['ca_code'] or ''} {p['name']}".strip()
    if p["schedule_status"] == "po":
        return {"kind": "po", "project_id": p["id"], "tone": "warn", "tab": "init", "action": "Open",
                "title": f"New PO {p['po_number']}:", "text": f"{label}. Accept it and confirm the start date."}
    if p["status"] != "active" or p["day"] < 1 or p["updated_today"]:
        return None
    missed = p["missed"]
    tail = f" {missed} day{'s' if missed > 1 else ''} missed in a row." if missed else ""
    due = "overdue" if past_cutoff else f"due by {cutoff}"
    return {"kind": "update", "project_id": p["id"], "tone": "bad" if past_cutoff else "", "tab": "update",
            "action": "Update now", "title": f"Daily update {due}:", "text": f"{label}.{tail}"}


def _home_kpis(projects: list[dict], alerts: list[dict]) -> dict:
    """The four counters at the top of the vendor home."""
    return {
        "active_sites": sum(1 for p in projects if p["status"] == "active" and p["schedule_status"] != "po"),
        "updates_due": sum(1 for a in alerts if a["kind"] == "update"),
        "pos_to_accept": sum(1 for p in projects if p["schedule_status"] == "po"),
        "late_sites": sum(1 for p in projects if p["schedule_status"] == "late"),
    }


async def vendor_home(session: AsyncSession, *, tenant_id: str | UUID, vendor_id: str) -> dict:
    """KPIs, today's to-dos and the vendor's allocated sites."""
    ctx = await _ctx(session, tenant_id)
    rows = await _project_rows(session, tenant_id, vendor_id=vendor_id)
    ups = await _updates_for(session, [r["id"] for r in rows])
    projects = [_summary(ctx, r, ups.get(str(r["id"]), [])) for r in rows]
    cutoff = ctx.settings["update_cutoff_local"].strftime("%H:%M")
    alerts = [a for a in (_home_alert(p, past_cutoff=ctx.past_cutoff, cutoff=cutoff) for p in projects) if a]
    return {"kpis": _home_kpis(projects, alerts), "alerts": alerts, "projects": projects}


async def _vendor_project(session: AsyncSession, tenant_id, vendor_id: str, project_id: str) -> Any:
    rows = await _project_rows(session, tenant_id, vendor_id=vendor_id, project_id=project_id)
    if not rows:
        raise _not_found()
    return rows[0]


async def vendor_project_detail(session: AsyncSession, *, tenant_id: str | UUID, vendor_id: str, project_id: str) -> dict:
    """One of the vendor's own sites."""
    p = await _vendor_project(session, tenant_id, vendor_id, project_id)
    ctx = await _ctx(session, tenant_id)
    ups = (await _updates_for(session, [p["id"]])).get(str(p["id"]), [])
    return await _detail(session, ctx, tenant_id, p, ups)


async def vendor_update_log(session: AsyncSession, *, tenant_id: str | UUID, vendor_id: str, project_id: str) -> dict:
    """The daily-update log, including days with no update."""
    p = await _vendor_project(session, tenant_id, vendor_id, project_id)
    ctx = await _ctx(session, tenant_id)
    ups = (await _updates_for(session, [p["id"]])).get(str(p["id"]), [])
    phases, duration, _ = _schedule(ctx, p, ups)
    return _log_entries(ctx, p, ups, phases, duration)


async def accept_po(session: AsyncSession, *, tenant_id: str | UUID, actor: dict, vendor_id: str, project_id: str, start_date: Any) -> dict:
    """Vendor accepts the PO and confirms the start date (not before the PO date)."""
    p = await _vendor_project(session, tenant_id, vendor_id, project_id)
    if p["accepted_at"] is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This PO is already accepted.")
    if p["status"] != "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This PO is no longer open.")
    start = _date_or_422(start_date, "Start date")
    if start < p["po_date"]:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="The start date cannot be before the PO date.")
    async with transaction(session):
        res = await session.execute(
            text("""
                UPDATE vendor_projects SET start_date = :start, accepted_at = now(), accepted_by = :uid, updated_at = now()
                 WHERE id = CAST(:pid AS uuid) AND tenant_id = :tid AND accepted_at IS NULL
            """),
            {"start": start, "uid": actor["sub"], "pid": str(p["id"]), "tid": tenant_id},
        )
        if res.rowcount == 0:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This PO is already accepted.")
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=p["site_id"], actor_id=actor["sub"], actor_name=actor.get("name"),
            action="vendor_po_accepted", entity_type="vendor_project", entity_id=p["id"], detail=f"start={start.isoformat()}",
        )
    return await vendor_project_detail(session, tenant_id=tenant_id, vendor_id=vendor_id, project_id=project_id)


async def save_initiation(session: AsyncSession, *, tenant_id: str | UUID, actor: dict, vendor_id: str, project_id: str, body: dict) -> dict:
    """People on site, delivery plan and the VENDOR half of the mobilisation
    checklist. Brand-side items are ignored here — the vendor cannot tick them."""
    p = await _vendor_project(session, tenant_id, vendor_id, project_id)
    try:
        crew = max(1, min(500, int(body.get("crew_size") or 1)))
    except (TypeError, ValueError):
        crew = p["crew_size"] or 1
    vendor_items = {it["id"] for it in await vendor_service.get_checklist(session, tenant_id, active_only=True)
                    if it["kind"] == "mobilisation_vendor"}
    async with transaction(session):
        await session.execute(
            text("""
                UPDATE vendor_projects SET supervisor_name = :sn, supervisor_phone = :sp, crew_size = :crew,
                       delivery_plan = :dp, updated_at = now()
                 WHERE id = CAST(:pid AS uuid) AND tenant_id = :tid
            """),
            {"sn": vendor_service.clean_text(body.get("supervisor_name"), 120),
             "sp": vendor_service.clean_text(body.get("supervisor_phone"), 40),
             "crew": crew, "dp": vendor_service.clean_text(body.get("delivery_plan"), 4000),
             "pid": str(p["id"]), "tid": tenant_id},
        )
        for item_id, checked in (body.get("checks") or {}).items():
            if str(item_id) not in vendor_items:
                continue
            await session.execute(
                text("""
                    INSERT INTO vendor_project_checks (project_id, item_id, checked, checked_by, checked_at)
                    VALUES (CAST(:pid AS uuid), CAST(:iid AS uuid), :c, :uid, now())
                    ON CONFLICT (project_id, item_id) DO UPDATE SET checked = EXCLUDED.checked,
                        checked_by = EXCLUDED.checked_by, checked_at = now()
                """),
                {"pid": str(p["id"]), "iid": str(item_id), "c": bool(checked), "uid": actor["sub"]},
            )
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=p["site_id"], actor_id=actor["sub"], actor_name=actor.get("name"),
            action="vendor_initiation_saved", entity_type="vendor_project", entity_id=p["id"],
        )
    return await vendor_project_detail(session, tenant_id=tenant_id, vendor_id=vendor_id, project_id=project_id)


async def submit_today(session: AsyncSession, *, tenant_id: str | UUID, actor: dict, vendor_id: str, project_id: str, body: dict) -> dict:
    """Create or edit TODAY's update (no backfill). Progress is cumulative %
    per phase, clamped to 0..100; phases not sent keep their last value."""
    p = await _vendor_project(session, tenant_id, vendor_id, project_id)
    ctx = await _ctx(session, tenant_id)
    ups = (await _updates_for(session, [p["id"]])).get(str(p["id"]), [])
    phases, _, s = _schedule(ctx, p, ups)
    if not (p["accepted_at"] is not None and s.day >= 1 and p["status"] == "active"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Daily updates are not open for this site.")
    sent = body.get("progress") or {}
    last = ups[-1]["progress"] if ups else {}
    progress = {}
    for ph in phases:
        raw = sent.get(ph.key, last.get(ph.key, 0))
        try:
            progress[ph.key] = max(0, min(100, int(round(float(raw)))))
        except (TypeError, ValueError):
            progress[ph.key] = int(last.get(ph.key, 0) or 0)
    try:
        manpower = max(0, min(5000, int(body.get("manpower") or 0)))
    except (TypeError, ValueError):
        manpower = 0
    params = {
        "tid": tenant_id, "pid": str(p["id"]), "d": ctx.today, "dn": s.day, "mp": manpower,
        "sup": bool(body.get("supervisor_on_site")), "ppe": bool(body.get("ppe_ok")),
        "mat": vendor_service.clean_text(body.get("material"), 300),
        "note": vendor_service.clean_text(body.get("note"), 1000) or "Work in progress",
        "hin": vendor_service.clean_text(body.get("hindrance_text"), 1000),
        "uid": actor["sub"], "late": ctx.past_cutoff,
    }
    async with transaction(session):
        update_id = (await session.execute(
            text("""
                INSERT INTO vendor_daily_updates (tenant_id, project_id, report_date, day_no, manpower, supervisor_on_site,
                    ppe_ok, material, note, hindrance_text, submitted_at, submitted_by, submitted_late)
                VALUES (:tid, CAST(:pid AS uuid), :d, :dn, :mp, :sup, :ppe, :mat, :note, :hin, now(), :uid, :late)
                ON CONFLICT (project_id, report_date) DO UPDATE SET
                    manpower = EXCLUDED.manpower, supervisor_on_site = EXCLUDED.supervisor_on_site, ppe_ok = EXCLUDED.ppe_ok,
                    material = EXCLUDED.material, note = EXCLUDED.note,
                    hindrance_text = COALESCE(EXCLUDED.hindrance_text, vendor_daily_updates.hindrance_text),
                    submitted_at = now(), submitted_by = EXCLUDED.submitted_by, submitted_late = EXCLUDED.submitted_late
                RETURNING id
            """),
            params,
        )).scalar()
        for key, pct in progress.items():
            await session.execute(
                text("""
                    INSERT INTO vendor_update_progress (update_id, phase_key, percent) VALUES (:uid, :k, :p)
                    ON CONFLICT (update_id, phase_key) DO UPDATE SET percent = EXCLUDED.percent
                """),
                {"uid": update_id, "k": key, "p": pct},
            )
        await write_audit_event(
            session, tenant_id=tenant_id, site_id=p["site_id"], actor_id=actor["sub"], actor_name=actor.get("name"),
            action="vendor_daily_update", entity_type="vendor_project", entity_id=p["id"],
            detail=f"day={s.day} overall={round(overall_pct(phases, progress), 1)}",
        )
    return await vendor_project_detail(session, tenant_id=tenant_id, vendor_id=vendor_id, project_id=project_id)
