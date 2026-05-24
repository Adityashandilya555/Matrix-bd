"""FastAPI application entrypoint."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import settings
from app.db.session import engine
from app.routers import audit, auth, bd, delegations, loi, notifications, sites, staging, tenancy, users


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
    await engine.dispose()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Last-resort handler. Logs the traceback and returns a sanitised 500
    so we never leak stack traces in production responses."""
    log.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error"},
    )


for router_module in (auth, bd, loi, staging, sites, audit, notifications, tenancy, users, delegations):
    app.include_router(router_module.router, prefix=settings.api_prefix)


@app.get("/api/health")
async def health() -> dict:
    """Health check — does not touch the DB so it stays fast for load balancers."""
    return {"status": "ok", "version": "0.1.0"}


@app.get("/api/health/db")
async def health_db() -> dict:
    """Deep health check — round-trips a SELECT 1 against Supabase."""
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "ok"}
