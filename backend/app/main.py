"""FastAPI application entrypoint."""
from __future__ import annotations

import logging
import re
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import settings
from app.core.ratelimit import rate_limit
from app.db.session import engine
from app.routers import audit, auth, bd, business_admin, delegations, design, launch_approval, legal, loi, notifications, nso, project, sites, staging, supervisor_codes, tenancy, users


log = logging.getLogger("matrix.api")
logging.basicConfig(level=getattr(logging, settings.log_level, logging.INFO))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Smoke-test the DB connection at boot so misconfigured deployments fail fast.
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
            log.info("Database connection OK")
    except Exception as exc:
        log.exception("Database connection failed at startup: %s", exc)
    yield
    # Close the shared storage HTTP client's pooled connections (#94) and the DB pool.
    from app.services.storage_service import aclose_storage_client
    await aclose_storage_client()
    await engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    # Swagger + the machine-readable schema are an attacker's site map (#111).
    # Off unless explicitly enabled (ENABLE_DOCS=true for local dev).
    docs_url="/api/docs" if settings.enable_docs else None,
    redoc_url=None,
    openapi_url="/api/openapi.json" if settings.enable_docs else None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.effective_cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _cors_headers_for(request: Request) -> dict[str, str]:
    """CORS headers to echo back on an error response.

    Starlette runs the `Exception` handler in ServerErrorMiddleware, which sits
    *outside* CORSMiddleware — so a 500 returned here would otherwise carry no
    `Access-Control-Allow-Origin` header and the browser reports it as a generic
    "Network Error" instead of the real status. Re-apply the headers (mirroring
    the CORSMiddleware allow-list) so the frontend can actually read the 500.
    """
    origin = request.headers.get("origin")
    if not origin:
        return {}
    allowed = origin in settings.cors_origin_list
    if not allowed and settings.effective_cors_origin_regex:
        allowed = bool(re.fullmatch(settings.effective_cors_origin_regex, origin))
    if not allowed:
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Vary": "Origin",
    }


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Last-resort handler. Logs the traceback and returns a sanitised 500
    so we never leak stack traces in production responses."""
    log.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error"},
        headers=_cors_headers_for(request),
    )


for router_module in (auth, bd, legal, design, project, nso, launch_approval, loi, staging, sites, audit, notifications, tenancy, users, delegations, business_admin, supervisor_codes):
    app.include_router(router_module.router, prefix=settings.api_prefix)


@app.get("/api/health")
async def health() -> dict:
    """Health check — does not touch the DB so it stays fast for load balancers."""
    return {"status": "ok", "version": "0.1.0"}


@app.get("/api/health/db", dependencies=[Depends(rate_limit(times=30, seconds=60))])
async def health_db() -> dict:
    """Deep health check — round-trips a SELECT 1 against Supabase.
    Rate-limited (#109): each call burns a pgBouncer slot round-trip."""
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "ok"}
