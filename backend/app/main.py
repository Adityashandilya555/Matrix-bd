"""FastAPI application entrypoint."""
from __future__ import annotations

import asyncio
import contextvars
import json
import logging
import re
import uuid
from contextlib import asynccontextmanager, suppress

from fastapi import Depends, FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.ratelimit import rate_limit
from app.db.session import engine
from app.routers import audit, auth, bd, business_admin, delegations, design, financial_closure, launch_approval, legal, loi, notifications, nso, project, project_excellence, sites, staging, supervisor_codes, tenancy, users


# ── Structured / JSON logging (#117) ─────────────────────────────────────────
# One JSON object per log line.  Each line carries:
#   ts, level, logger, request_id, msg  (+ exc on exceptions)
# This makes Railway log streams grep/filter-friendly and correlatable.

_request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar(
    "request_id", default="-"
)


class _JsonFormatter(logging.Formatter):
    """Emit one JSON object per log record — structured logging for Railway."""

    def format(self, record: logging.LogRecord) -> str:
        obj: dict = {
            "ts":         self.formatTime(record, "%Y-%m-%dT%H:%M:%SZ"),
            "level":      record.levelname,
            "logger":     record.name,
            "request_id": _request_id_var.get("-"),
            "msg":        record.getMessage(),
        }
        if record.exc_info:
            obj["exc"] = self.formatException(record.exc_info)
        return json.dumps(obj, ensure_ascii=False)


_handler = logging.StreamHandler()
_handler.setFormatter(_JsonFormatter())
logging.root.handlers = [_handler]
logging.root.setLevel(getattr(logging, settings.log_level, logging.INFO))

log = logging.getLogger("matrix.api")


def _int_or_zero(value: str | None) -> int:
    """Parse an env var into a non-negative int; 0 on unset/garbage."""
    try:
        return max(0, int(value)) if value else 0
    except (TypeError, ValueError):
        return 0


# ── Request ID middleware (#117) ──────────────────────────────────────────────

class _RequestIdMiddleware(BaseHTTPMiddleware):
    """Generate a UUID per request; expose it via X-Request-Id response header.

    The ID is stored in a contextvars.ContextVar so the JSON log formatter
    can stamp every log line with the current request ID — correlating a
    production 500 traceback to the exact request without timestamp-guessing.
    """

    async def dispatch(self, request: Request, call_next):
        rid = str(uuid.uuid4())
        token = _request_id_var.set(rid)
        request.state.request_id = rid
        try:
            response = await call_next(request)
            response.headers["X-Request-Id"] = rid
            return response
        finally:
            _request_id_var.reset(token)


# ── Background email drain (#112) ─────────────────────────────────────────────

async def _email_drain_loop() -> None:
    """Poll notification_outbox for pending email rows and dispatch via Resend.

    Only runs when RESEND_API_KEY is set in the environment.  Errors inside a
    single drain run are caught and logged so the loop never dies silently.
    """
    from app.services.notification_service import drain_pending_emails

    interval = settings.notification_drain_interval_secs
    log.info("email_drain: loop started (interval=%ds)", interval)
    while True:
        try:
            count = await drain_pending_emails(
                resend_api_key=settings.resend_api_key,
                batch_size=20,
            )
            if count:
                log.info("email_drain: dispatched %d email(s)", count)
        except Exception:
            log.exception("email_drain: unexpected error in drain run")
        await asyncio.sleep(interval)


# ── Application lifespan ──────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Smoke-test the DB — FAIL FAST so Railway ON_FAILURE can restart (#116).
    # Previously the except block only logged and fell through to `yield`,
    # meaning a deploy with a bad DATABASE_URL would boot, pass Railway's port
    # check, and then 500 on every authenticated request indefinitely.
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
            log.info("startup: database connection OK")
    except Exception as exc:
        log.exception(
            "startup: database connection failed — exiting so Railway restarts: %s", exc
        )
        raise SystemExit(1) from exc  # triggers ON_FAILURE restart

    # ── Rate-limiter single-instance invariant (#225, 3.2).
    # The limiter store (app/core/ratelimit.py) is a process-local dict — valid
    # ONLY while the backend runs as a single uvicorn process on a single
    # replica. With >1 worker/replica each process keeps its own windows, so the
    # effective limit is multiplied by the process count and load-balanced
    # attackers get a fresh counter per worker. There is no Redis store yet, so
    # scaling out silently weakens brute-force protection — warn loudly instead
    # of failing the boot. The long-term fix is the Redis store swap behind the
    # same interface; until then, keep WEB_CONCURRENCY unset / replicas = 1.
    import os

    _concurrency = max(
        _int_or_zero(os.getenv("WEB_CONCURRENCY")),
        _int_or_zero(os.getenv("UVICORN_WORKERS")),
        _int_or_zero(os.getenv("RAILWAY_REPLICA_COUNT")),
    )
    if _concurrency > 1:
        log.warning(
            "startup: in-memory rate limiter active but %d workers/replicas are "
            "configured — windows are NOT shared across processes, so the "
            "effective per-client limit is multiplied and brute-force protection "
            "is weakened (#225). Run a single process/replica, or migrate the "
            "limiter store to Redis before scaling out.",
            _concurrency,
        )

    # ── Start background email drain (only when RESEND_API_KEY is configured).
    drain_task: asyncio.Task | None = None
    if settings.resend_api_key:
        drain_task = asyncio.create_task(_email_drain_loop())
    else:
        log.warning(
            "startup: RESEND_API_KEY not set — email notifications will accumulate "
            "in notification_outbox and will NOT be delivered (#112)"
        )

    yield

    # ── Graceful shutdown.
    if drain_task:
        drain_task.cancel()
        with suppress(asyncio.CancelledError):
            await drain_task

    from app.services.storage_service import aclose_storage_client
    await aclose_storage_client()
    await engine.dispose()


# ── FastAPI app ───────────────────────────────────────────────────────────────

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

# Middleware order: last add_middleware() call → outermost wrapper → runs first.
# _RequestIdMiddleware is outermost so every request gets an ID before CORS
# headers or route logic runs.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.effective_cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(_RequestIdMiddleware)  # outermost — runs first on ingress


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
    """Last-resort handler. Logs the traceback (with request_id) and returns a
    sanitised 500 so we never leak stack traces in production responses (#117)."""
    rid = getattr(request.state, "request_id", "-")
    log.exception(
        "unhandled exception on %s %s [request_id=%s]",
        request.method, request.url.path, rid,
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        # Include request_id in the response body so support can match a
        # user's screenshot to the exact Railway log line.
        content={"detail": "Internal server error", "request_id": rid},
        headers={**_cors_headers_for(request), "X-Request-Id": rid},
    )


for router_module in (auth, bd, legal, design, project, project_excellence, financial_closure, nso, launch_approval, loi, staging, sites, audit, notifications, tenancy, users, delegations, business_admin, supervisor_codes):
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
