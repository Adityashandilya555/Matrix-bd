"""LOI service — real queries + Supabase Storage handoff."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import models
from app.db.session import transaction
from app.domain.schemas.common import OkResponse
from app.domain.schemas.loi import LOIUploadResponse, LOIViewResponse
from app.domain.state_machine import SiteStatus, assert_transition
from fastapi import HTTPException, status as http_status

from app.services._common import fetch_site_for_update_or_404, fetch_site_or_404
from app.services.audit_service import write_audit_event
from app.services.notification_service import (
    enqueue as notify_enqueue,
    recipients_for_site_owner,
    recipients_for_supervisors,
)
from app.services.storage_service import safe_object_name, signed_url, upload_bytes


async def svc_upload_loi(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    filename: str,
    content_type: Optional[str],
    file_bytes: bytes,
) -> LOIUploadResponse:
    """Upload the signed LOI: transitions approved -> loi_uploaded, stores the
    file in Supabase Storage, persists a site_files row, writes audit + outbox."""
    # Validate read-only FIRST, capturing what we need, then release the
    # connection BEFORE the slow Supabase Storage upload. Running the upload
    # inside the transaction (the old shape) pinned a pgBouncer slot for the
    # whole 30s HTTP budget and exhausted the pool under load (#89).
    site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
    # Site owner restriction (Todo #6). The executive who originally captured
    # the site may upload the LOI. Supervisor-created pipelines are handed off
    # through `assigned_to`, so that assigned executive must also be allowed.
    actor_role = (actor.get("role") or "").lower()
    actor_id = str(actor["sub"])
    submitted_by = str(site.submitted_by) if site.submitted_by else None
    assigned_to = str(site.assigned_to) if site.assigned_to else None
    status_now = site.status
    await session.rollback()  # end the implicit read txn → free the slot for the upload

    if actor_role == "executive" and actor_id not in {submitted_by, assigned_to}:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Only the executive who submitted or was assigned this site can upload its LOI.",
        )
    assert_transition(SiteStatus(status_now), SiteStatus.LOI_UPLOADED)

    # Sanitise the storage key — Supabase rejects non-ASCII keys (400).
    storage_path = f"loi/{tenant_id}/{site_id}/{safe_object_name(filename, fallback='loi.pdf')}"
    await upload_bytes(
        path=storage_path, body=file_bytes, content_type=content_type or "application/pdf",
    )

    async with transaction(session):
        # Re-load inside the write txn and re-assert — the validation above can
        # race a concurrent transition.
        site = await fetch_site_for_update_or_404(session, site_id=site_id, tenant_id=tenant_id)
        assert_transition(SiteStatus(site.status), SiteStatus.LOI_UPLOADED)

        # Demote any previous LOI before adding the new primary. A send-back →
        # re-upload cycle would otherwise leave several rows all flagged
        # is_primary=True (there is no unique constraint), and
        # business_admin_documents_service lists every row unfiltered.
        await session.execute(
            update(models.SiteFile)
            .where(
                models.SiteFile.site_id == site.id,
                models.SiteFile.tenant_id == tenant_id,
                models.SiteFile.file_type == "loi",
                models.SiteFile.is_primary.is_(True),
            )
            .values(is_primary=False)
        )
        session.add(models.SiteFile(
            tenant_id=tenant_id,
            site_id=site.id,
            uploaded_by=actor["sub"],
            file_type="loi",
            file_name=filename,
            storage_path=storage_path,
            file_size_kb=max(1, len(file_bytes) // 1024),
            mime_type=content_type,
            is_primary=True,
            source="manual_upload",
        ))
        site.status = SiteStatus.LOI_UPLOADED.value
        site.loi_uploaded_at = datetime.now(timezone.utc)
        # A fresh upload answers the send-back, so the rejection banner must go.
        site.loi_rejection_note = None

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="upload_loi",
            from_status=SiteStatus.APPROVED.value,
            to_status=SiteStatus.LOI_UPLOADED.value,
            detail=filename,
        )
        recipients = await recipients_for_supervisors(session, tenant_id=tenant_id)
        await notify_enqueue(
            session, tenant_id=tenant_id, event="loi_uploaded",
            recipient_ids=recipients, site_id=site.id,
            channels=("email", "slack", "in_app"),
            payload={"site_id": str(site.id), "filename": filename},
        )

    days_to_loi = 0
    if site.approved_at and site.loi_uploaded_at:
        days_to_loi = (site.loi_uploaded_at.date() - site.approved_at.date()).days
    return LOIUploadResponse(
        site_id=str(site.id),
        loi_uploaded=True,
        loi_uploaded_at=site.loi_uploaded_at.date() if site.loi_uploaded_at else datetime.now(timezone.utc).date(),
        days_to_loi=days_to_loi,
    )


async def svc_view_loi(
    session: AsyncSession, *, tenant_id: str | UUID, site_id: str | UUID,
) -> LOIViewResponse:
    """Return the most recent LOI for a site with a short-lived signed URL."""
    from sqlalchemy import select

    site = await fetch_site_or_404(session, site_id=site_id, tenant_id=tenant_id)
    stmt = (
        select(models.SiteFile)
        .where(models.SiteFile.site_id == site.id, models.SiteFile.file_type == "loi")
        .order_by(models.SiteFile.uploaded_at.desc())
        .limit(1)
    )
    file = (await session.execute(stmt)).scalar_one_or_none()
    if file is None:
        # Nothing uploaded yet — a legitimate answer, not an error.
        return LOIViewResponse(site_id=str(site.id), file_url=None, uploaded_at=None, uploaded_by=None)

    url = await signed_url(file.storage_path)
    if url is None:
        # The row exists, so a null URL can only mean the signer failed —
        # signed_url swallows missing config, non-2xx, and httpx/JSON errors.
        # Returning 200-with-null here is what made "View LOI" look dead; a 503
        # is honest and tells the caller it is worth retrying.
        raise HTTPException(
            status_code=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The LOI is stored but its download link could not be generated. Please try again in a moment.",
        )
    return LOIViewResponse(
        site_id=str(site.id),
        file_url=url,
        uploaded_at=file.uploaded_at.date(),
        uploaded_by=str(file.uploaded_by),
    )


# ── LOI send-back ─────────────────────────────────────────────────────────────

async def svc_send_back_loi(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    comments: str,
) -> OkResponse:
    """Supervisor rejects an uploaded LOI, returning the site to APPROVED.

    The executive then re-uploads through the unchanged upload path — that is
    the whole reason this returns to APPROVED rather than inventing a new
    status. loi_uploaded_at is cleared so the days-to-LOI clock resumes from
    approved_at: the LOI genuinely is not done, and leaving the timestamp would
    freeze the SLA bar at its old value while the row reads "Awaiting LOI".
    """
    note = (comments or "").strip()
    if not note:
        # Validate before opening a transaction — the executive needs to be told
        # what was wrong with the file.
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Comments are required to send an LOI back.",
        )

    async with transaction(session):
        site = await fetch_site_for_update_or_404(session, site_id=site_id, tenant_id=tenant_id)
        # Guards a double-click and a send-back racing the supervisor's own
        # Push-to-Legal: the loser gets 422 instead of corrupting the state.
        assert_transition(SiteStatus(site.status), SiteStatus.APPROVED)

        site.status = SiteStatus.APPROVED.value
        site.loi_uploaded_at = None
        site.loi_rejection_note = note

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor.get("name"),
            action="send_back_loi",
            from_status=SiteStatus.LOI_UPLOADED.value,
            to_status=SiteStatus.APPROVED.value,
            detail=note,
        )
        # The site owner is exactly who svc_upload_loi permits to re-upload.
        recipients = await recipients_for_site_owner(session, site=site)
        if recipients:
            await notify_enqueue(
                session, tenant_id=tenant_id, event="loi_sent_back",
                recipient_ids=recipients, site_id=site.id,
                channels=("in_app", "email"),
                payload={"site_id": str(site.id), "site_name": site.name, "comments": note},
                subject=f"LOI needs re-upload: {site.name}",
                body=(
                    f"The LOI for '{site.name}' ({site.code}) was sent back by your supervisor.\n\n"
                    f"Comments: {note}\n\n"
                    f"Open the staging list to upload the corrected document."
                ),
            )
    return OkResponse(message="LOI sent back for re-upload.")


async def svc_set_loi_timeline(
    session: AsyncSession,
    *,
    tenant_id: str | UUID,
    actor: dict,
    site_id: str | UUID,
    expected_loi_days: int,
) -> OkResponse:
    """Supervisor sets/updates expected LOI days. Persisted on the latest
    approvals row (since the column lives there), with an audit event."""
    from sqlalchemy import select

    async with transaction(session):
        site = await fetch_site_for_update_or_404(session, site_id=site_id, tenant_id=tenant_id)
        stmt = (
            select(models.Approval)
            .where(models.Approval.site_id == site.id)
            .order_by(models.Approval.created_at.desc())
            .limit(1)
        )
        row = (await session.execute(stmt)).scalar_one_or_none()
        old = row.expected_loi_days if row else None
        if row is None:
            row = models.Approval(
                tenant_id=tenant_id,
                site_id=site.id,
                approver_id=actor["sub"],
                status="approved",
                expected_loi_days=expected_loi_days,
                decided_at=datetime.now(timezone.utc),
            )
            session.add(row)
        else:
            row.expected_loi_days = expected_loi_days

        await write_audit_event(
            session, tenant_id=tenant_id, site_id=site.id,
            actor_id=actor["sub"], actor_name=actor["name"],
            action="set_loi_timeline",
            field_name="expected_loi_days",
            from_value=str(old) if old is not None else None,
            to_value=str(expected_loi_days),
            detail=f"expected_loi_days={expected_loi_days}",
        )
    return OkResponse(message=f"LOI timeline set to {expected_loi_days} days for site {site_id}")
