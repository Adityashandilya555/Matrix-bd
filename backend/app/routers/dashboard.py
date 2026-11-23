"""Role dashboards: a summary payload per caller and a cheap change detector.

``/dashboard/version`` lets the frontend poll every 15 seconds for the price of
one small statement, and reload ``/dashboard/summary`` only when it moves. What
each role sees is decided in ``app.services.dashboard_service``.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal, Optional

from fastapi import APIRouter, Header, Query, Response

from app.core.deps import CurrentUser, DbDep, TenantId
from app.services import dashboard_service as svc

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/version", response_model=None)
async def dashboard_version(
    response: Response,
    db: DbDep,
    _user: CurrentUser,
    tenant_id: TenantId,
    if_none_match: Annotated[Optional[str], Header()] = None,
) -> Response | dict:
    """``{version, generated_at}`` with an ETag, or 304 when nothing changed."""
    version = await svc.get_version(db, tenant_id)
    etag = svc.version_etag(version)
    if svc.etag_matches(if_none_match, version):
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "no-cache"})
    response.headers["ETag"] = etag
    response.headers["Cache-Control"] = "no-cache"
    return {"version": version, "generated_at": datetime.now(timezone.utc).isoformat()}


@router.get("/summary")
async def dashboard_summary(
    db: DbDep,
    user: CurrentUser,
    scope: Literal["module", "team"] = Query("module"),
) -> dict:
    """The caller's dashboard: only the sections their role may see.

    Carries the version taken *before* the sections are read, so the client
    can poll from it: a change landing while the summary is built moves the
    version past this one and is picked up by the next check.
    """
    version = await svc.get_version(db, str(user["tenant_id"]))
    return {**await svc.build_summary(db, user, scope), "version": version}
