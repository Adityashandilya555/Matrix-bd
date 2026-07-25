"""Finance service — CA code entry, KYC gate, amount, and the
exec → supervisor → admin approval chain.

finance_status column tracks the sub-workflow:
  pending  →  awaiting_supervisor  →  awaiting_admin  →  approved
"""
from __future__ import annotations

from typing import NoReturn, Optional
from uuid import UUID

from fastapi import HTTPException, status as http_status
import re
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.db.session import transaction
from app.domain.state_machine import SiteStatus
from app.services._common import (
    assert_executive_owns_site,
    fetch_site_for_update_or_404,
    is_unique_violation,
)
from app.services.audit_service import write_audit_event
from app.services.workflow_unlocks import maybe_unlock_design
from app.services.notification_service import (
    enqueue as notify_enqueue,
    recipients_for_business_admins,
    recipients_for_supervisors,
    recipients_for_site_owner,
)

# Statuses where the finance tab is accessible
_LOI_AND_BEYOND = {
    "loi_uploaded", "legal_review", "legal_approved", "pushed_to_payments",
}

_FINANCE_STATUS_ORDER = ("pending", "awaiting_supervisor", "awaiting_admin", "approved")


_CA_CODE_TAKEN = (
    "CA code {code} is already in use by '{name}' ({site_code}). "
    "Each site needs its own CA code."
)


async def _assign_ca_code(
    session: AsyncSession, *, site, tenant_id: str | UUID, ca_code: Optional[str],
) -> None:
    """Claim a CA / Commercial Code for this site.

    A code belongs to exactly one site per workspace. The real guarantee is the
    partial unique index ``uq_sites_tenant_ca_code`` (20260810) — this lookup
    exists so the common case gets a message naming the site that already holds
    the code, instead of a bare constraint error. The caller already holds the
    row lock from ``fetch_site_for_update_or_404``.
    """
    normalized = (ca_code or "").strip().upper() or None
    if normalized == site.ca_code:
        return
    if normalized is not None:
        clash = (await session.execute(
            select(models.Site.name, models.Site.code).where(
                models.Site.tenant_id == tenant_id,
                models.Site.id != site.id,
                func.upper(models.Site.ca_code) == normalized,
            )
        )).first()
        if clash:
            raise HTTPException(
                http_status.HTTP_409_CONFLICT,
                detail=_CA_CODE_TAKEN.format(
                    code=normalized, name=clash.name, site_code=clash.code or "no code",
                ),
            )
    site.ca_code = normalized


def _raise_ca_code_conflict(exc: IntegrityError, ca_code: Optional[str]) -> NoReturn:
    """Turn a lost race on uq_sites_tenant_ca_code into the same 409 the
    pre-check raises. Only a unique violation on that index is translated — an
    FK / NOT NULL / CHECK failure is a real error and must propagate."""
    if not (is_unique_violation(exc) and "uq_sites_tenant_ca_code" in str(exc)):
        raise exc
    code = (ca_code or "").strip().upper()
    raise HTTPException(
        http_status.HTTP_409_CONFLICT,
        detail=(
            f"CA code {code} was just claimed by another site. "
            "Each site needs its own CA code."
        ),
    ) from exc


def _finance_snapshot(site) -> dict:
    return {
        "kyc_verified":    site.kyc_verified,
        "ca_code":         site.ca_code,
        "finance_amount":  float(site.finance_amount) if site.finance_amount is not None else None,
        "finance_status":  site.finance_status,
    }


async def svc_save_finance_draft(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    kyc_verified: Optional[bool] = None,
    ca_code: Optional[str] = None,
    finance_amount: Optional[float] = None,
) -> dict:
    """Idempotent save of KYC flag, CA code, and amount.

    Available to exec and supervisor. Only permitted while finance_status is
    'pending' (once submitted for approval the fields are locked).
    """
    try:
        async with transaction(session):
            site = await fetch_site_for_update_or_404(session, site_id=site_id, tenant_id=tenant_id)
            assert_executive_owns_site(actor, site)

            if site.status not in _LOI_AND_BEYOND:
                raise HTTPException(
                    http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Finance details can only be entered after the LOI is uploaded.",
                )
            if site.finance_status != "pending":
                raise HTTPException(
                    http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Finance is already in '{site.finance_status}' — fields are locked.",
                )

            if kyc_verified is not None:
                site.kyc_verified = kyc_verified
            if ca_code is not None:
                await _assign_ca_code(session, site=site, tenant_id=tenant_id, ca_code=ca_code)
            if finance_amount is not None:
                site.finance_amount = finance_amount

            await write_audit_event(
                session, tenant_id=tenant_id, site_id=site.id,
                actor_id=actor["sub"], actor_name=actor["name"],
                action="finance_draft_saved",
                detail=f"kyc={site.kyc_verified} ca_code={site.ca_code} amount={site.finance_amount}",
            )
    except IntegrityError as exc:
        _raise_ca_code_conflict(exc, ca_code)

    return _finance_snapshot(site)


async def svc_finance_request_approval(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    kyc_verified: Optional[bool] = None,
    ca_code: Optional[str] = None,
    finance_amount: Optional[float] = None,
) -> dict:
    """Exec requests supervisor approval.

    Requires KYC verified + CA code set + amount entered.
    Transitions finance_status: pending → awaiting_supervisor.
    """
    try:
        async with transaction(session):
            site = await fetch_site_for_update_or_404(session, site_id=site_id, tenant_id=tenant_id)
            assert_executive_owns_site(actor, site)

            if site.status not in _LOI_AND_BEYOND:
                raise HTTPException(
                    http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Finance approval can only be requested after the LOI is uploaded.",
                )
            if site.finance_status != "pending":
                raise HTTPException(
                    http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Already in '{site.finance_status}' — cannot re-submit.",
                )

            if kyc_verified is not None:
                site.kyc_verified = kyc_verified
            if ca_code is not None:
                await _assign_ca_code(session, site=site, tenant_id=tenant_id, ca_code=ca_code)
            if finance_amount is not None:
                site.finance_amount = finance_amount

            if not site.kyc_verified:
                raise HTTPException(
                    http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="KYC must be verified before requesting approval.",
                )
            if not site.ca_code:
                raise HTTPException(
                    http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="CA code must be entered before requesting approval.",
                )
            if site.finance_amount is None:
                raise HTTPException(
                    http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Amount must be entered before requesting approval.",
                )

            site.finance_status = "awaiting_supervisor"

            await write_audit_event(
                session, tenant_id=tenant_id, site_id=site.id,
                actor_id=actor["sub"], actor_name=actor["name"],
                action="finance_submitted",
                detail=f"ca_code={site.ca_code} amount={site.finance_amount}",
            )
            supervisors = await recipients_for_supervisors(session, tenant_id=tenant_id)
            safe_ca = re.sub(r"[^\w\-]", "", site.ca_code or "")
            await notify_enqueue(
                session, tenant_id=tenant_id, event="finance_submitted",
                recipient_ids=supervisors, site_id=site.id,
                channels=("in_app",),
                payload={"site_id": str(site.id), "site_name": site.name, "ca_code": site.ca_code},
                subject=f"Finance approval requested: {safe_ca or site.name}",
                body=(
                    f"Executive has requested finance approval for site "
                    f"'{site.name}' ({safe_ca or site.code}).\n"
                    f"Amount: ₹{site.finance_amount:,.2f}"
                ),
            )
    except IntegrityError as exc:
        _raise_ca_code_conflict(exc, ca_code)

    return _finance_snapshot(site)


async def svc_finance_reject(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    reason: Optional[str] = None,
) -> dict:
    """Business admin sends a finance request back for correction.

    awaiting_admin → pending. Resetting to 'pending' (rather than a terminal
    'rejected') unlocks the KYC / CA code / amount fields so the executive can
    fix the details and re-request approval through the normal chain.
    """
    actor_role = (actor.get("role") or "").lower()
    if actor_role not in ("business_admin", "supervisor"):
        raise HTTPException(
            http_status.HTTP_403_FORBIDDEN,
            detail="Only supervisors or business admins can reject finance.",
        )

    async with transaction(session):
        site = await fetch_site_for_update_or_404(session, site_id=site_id, tenant_id=tenant_id)

        allowed = {"awaiting_admin"} if actor_role == "business_admin" else {"awaiting_supervisor"}
        if site.finance_status not in allowed:
            raise HTTPException(
                http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Expected {allowed}, got '{site.finance_status}'.",
            )

        site.finance_status = "pending"

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action=f"finance_{actor_role}_rejected",
            detail=(
                f"{actor_role.capitalize()} sent finance back for correction. ca_code={site.ca_code}"
                + (f" reason={reason}" if reason else "")
            ),
        )

        owners = await recipients_for_site_owner(session, site=site)
        supervisors = await recipients_for_supervisors(session, tenant_id=tenant_id)
        all_recipients = list({*owners, *supervisors})
        safe_ca = re.sub(r"[^\w\-]", "", site.ca_code or "")
        await notify_enqueue(
            session, tenant_id=tenant_id, event="finance_rejected",
            recipient_ids=all_recipients, site_id=site.id,
            channels=("in_app",),
            payload={
                "site_id": str(site.id), "site_name": site.name,
                "ca_code": site.ca_code, "reason": reason,
            },
            subject=f"Finance sent back: {safe_ca or site.name}",
            body=(
                f"The {actor_role.replace('_', ' ')} has sent the finance request for '{site.name}' "
                f"({safe_ca or site.code}) back for correction."
                + (f"\nReason: {reason}" if reason else "")
                + "\nUpdate the details and re-request approval."
            ),
        )

    return _finance_snapshot(site)


async def svc_finance_approve(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
) -> dict:
    """Supervisor or admin approval step — determined by the actor's role
    and the current finance_status.

    supervisor (finance_status=awaiting_supervisor) → awaiting_admin
    business_admin (finance_status=awaiting_admin) → approved
    """
    actor_role = (actor.get("role") or "").lower()

    async with transaction(session):
        site = await fetch_site_for_update_or_404(session, site_id=site_id, tenant_id=tenant_id)
        safe_ca = re.sub(r"[^\w\-]", "", site.ca_code or "")

        if actor_role == "supervisor":
            if site.finance_status != "awaiting_supervisor":
                raise HTTPException(
                    http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Expected awaiting_supervisor, got '{site.finance_status}'.",
                )
            site.finance_status = "awaiting_admin"
            action = "finance_supervisor_approved"
            detail = f"Supervisor approved — forwarded to admin. ca_code={site.ca_code}"

            admin_ids = await recipients_for_business_admins(session, tenant_id=tenant_id)
            await notify_enqueue(
                session, tenant_id=tenant_id, event="finance_awaiting_admin",
                recipient_ids=admin_ids, site_id=site.id,
                channels=("in_app",),
                payload={"site_id": str(site.id), "site_name": site.name},
                subject=f"Finance approval needed: {safe_ca or site.name}",
                body=(
                    f"Supervisor approved finance for '{site.name}'. "
                    f"Awaiting your final approval. Amount: ₹{site.finance_amount:,.2f}"
                ),
            )

        elif actor_role == "business_admin":
            if site.finance_status != "awaiting_admin":
                raise HTTPException(
                    http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Expected awaiting_admin, got '{site.finance_status}'.",
                )
            site.finance_status = "approved"
            design_unlocked = await maybe_unlock_design(
                session,
                tenant_id=tenant_id,
                actor=actor,
                site=site,
                reason="finance_admin_approved",
            )
            action = "finance_admin_approved"
            detail = (
                f"Admin approved. ca_code={site.ca_code} amount={site.finance_amount}; "
                + (
                    "Design is available because DDR is already positive."
                    if design_unlocked or (site.legal_dd_status or "pending") == "positive"
                    else "Finance approved; Design waits for positive DDR."
                )
            )

            if site.status == SiteStatus.PUSHED_TO_PAYMENTS.value:
                await write_audit_event(
                    session, tenant_id=tenant_id, site_id=site.id,
                    actor_id=actor["sub"], actor_name=actor["name"],
                    action="payment_handoff",
                    from_status=SiteStatus.LEGAL_APPROVED.value,
                    to_status=SiteStatus.PUSHED_TO_PAYMENTS.value,
                    detail="Finance admin approval completed CA / Commercial Code.",
                )

            owners = await recipients_for_site_owner(session, site=site)
            supervisors = await recipients_for_supervisors(session, tenant_id=tenant_id)
            all_recipients = list({*owners, *supervisors})
            await notify_enqueue(
                session, tenant_id=tenant_id, event="finance_approved",
                recipient_ids=all_recipients, site_id=site.id,
                channels=("in_app", "email"),
                payload={"site_id": str(site.id), "site_name": site.name, "ca_code": site.ca_code},
                subject=f"Finance approved: {safe_ca or site.name}",
                body=(
                    f"Finance for site '{site.name}' ({safe_ca or site.code}) "
                    f"has been approved by the admin and pushed to the next handoff.\n"
                    f"Amount: ₹{site.finance_amount:,.2f}"
                ),
            )
        else:
            raise HTTPException(
                http_status.HTTP_403_FORBIDDEN,
                detail="Only supervisors and business admins can approve finance.",
            )

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action=action, detail=detail,
        )

    return _finance_snapshot(site)
