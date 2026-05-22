"""Notifications router — read-only feed for the current user.

Writes happen via the outbox (`app.services.notification_service.enqueue`)
inside each business service, never via a public HTTP endpoint. The old
`POST /notifications/send` endpoint has been removed — it was a foot-gun that
could write rows without going through the state machine.
"""
from __future__ import annotations

from fastapi import APIRouter, Query
from sqlalchemy import desc, select

from app.core.deps import CurrentUser, DbDep, TenantId
from app.db import models

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("", summary="List in-app notifications for the current user")
async def list_notifications(
    db: DbDep,
    current_user: CurrentUser,
    tenant_id: TenantId,
    limit: int = Query(50, le=200),
) -> dict:
    stmt = (
        select(models.NotificationOutbox)
        .where(
            models.NotificationOutbox.tenant_id == tenant_id,
            models.NotificationOutbox.recipient_id == current_user["sub"],
            models.NotificationOutbox.channel == "in_app",
        )
        .order_by(desc(models.NotificationOutbox.created_at))
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return {
        "items": [
            {
                "id": str(r.id),
                "type": r.type,
                "subject": r.subject,
                "body": r.body,
                "payload": r.payload,
                "status": r.status,
                "site_id": str(r.site_id) if r.site_id else None,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ],
        "total": len(rows),
    }
