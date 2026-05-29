"""Finance service — CA code entry, KYC gate, amount, and the
exec → supervisor → admin approval chain.

All operations are Site-Tracker-level (no change to sites.status).
finance_status column tracks the sub-workflow:
  pending  →  awaiting_supervisor  →  awaiting_admin  →  approved
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status as http_status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import transaction
from app.services._common import fetch_site_or_404
from app.services.audit_service import write_audit_event
from app.services.notification_service import (
    enqueue as notify_enqueue,
    recipients_for_supervisors,
    recipients_for_site_owner,
)

# Statuses where the finance tab is accessible
_LOI_AND_BEYOND = {
    "loi_uploaded", "legal_review", "legal_approved", "pushed_to_payments",
}

_FINANCE_STATUS_ORDER = ("pending", "awaiting_supervisor", "awaiting_admin", "approved")


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
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)

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
            site.ca_code = ca_code.strip() or None
        if finance_amount is not None:
            site.finance_amount = finance_amount

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="finance_draft_saved",
            detail=f"kyc={site.kyc_verified} ca_code={site.ca_code} amount={site.finance_amount}",
        )

    return _finance_snapshot(site)


async def svc_finance_request_approval(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
) -> dict:
    """Exec requests supervisor approval.

    Requires KYC verified + CA code set + amount entered.
    Transitions finance_status: pending → awaiting_supervisor.
    """
    async with transaction(session):
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)

        if site.status not in _LOI_AND_BEYOND:
            raise HTTPException(
                http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Finance approval can only be requested after the LOI is uploaded.",
            )
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
        if site.finance_status != "pending":
            raise HTTPException(
                http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Already in '{site.finance_status}' — cannot re-submit.",
            )

        site.finance_status = "awaiting_supervisor"

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="finance_submitted",
            detail=f"ca_code={site.ca_code} amount={site.finance_amount}",
        )
        supervisors = await recipients_for_supervisors(session, tenant_id=tenant_id)
        await notify_enqueue(
            session, tenant_id=tenant_id, event="finance_submitted",
            recipient_ids=supervisors, site_id=site.id,
            channels=("in_app",),
            payload={"site_id": str(site.id), "site_name": site.name, "ca_code": site.ca_code},
            subject=f"Finance approval requested: {site.ca_code or site.name}",
            body=(
                f"Executive has requested finance approval for site "
                f"'{site.name}' ({site.ca_code or site.code}).\n"
                f"Amount: ₹{site.finance_amount:,.2f}"
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
        site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)

        if actor_role == "supervisor":
            if site.finance_status != "awaiting_supervisor":
                raise HTTPException(
                    http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Expected awaiting_supervisor, got '{site.finance_status}'.",
                )
            site.finance_status = "awaiting_admin"
            action = "finance_supervisor_approved"
            detail = f"Supervisor approved — forwarded to admin. ca_code={site.ca_code}"

            # Notify business_admin users
            from sqlalchemy import select
            from app.db import models as _m
            admin_ids = (await session.execute(
                select(_m.User.id).where(
                    _m.User.tenant_id == site.tenant_id,
                    _m.User.role == "business_admin",
                    _m.User.is_active.is_(True),
                )
            )).scalars().all()
            await notify_enqueue(
                session, tenant_id=tenant_id, event="finance_awaiting_admin",
                recipient_ids=list(admin_ids), site_id=site.id,
                channels=("in_app",),
                payload={"site_id": str(site.id), "site_name": site.name},
                subject=f"Finance approval needed: {site.ca_code or site.name}",
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
            action = "finance_admin_approved"
            detail = f"Admin approved. ca_code={site.ca_code} amount={site.finance_amount}"

            # Notify site owner and supervisors
            owners = await recipients_for_site_owner(session, site=site)
            supervisors = await recipients_for_supervisors(session, tenant_id=tenant_id)
            all_recipients = list({*owners, *supervisors})
            await notify_enqueue(
                session, tenant_id=tenant_id, event="finance_approved",
                recipient_ids=all_recipients, site_id=site.id,
                channels=("in_app", "email"),
                payload={"site_id": str(site.id), "site_name": site.name, "ca_code": site.ca_code},
                subject=f"Finance approved: {site.ca_code or site.name}",
                body=(
                    f"Finance for site '{site.name}' ({site.ca_code or site.code}) "
                    f"has been approved by the admin.\nAmount: ₹{site.finance_amount:,.2f}"
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
