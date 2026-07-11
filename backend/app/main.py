"""FastAPI application entrypoint."""
from __future__ import annotations

import asyncio
import contextvars
import hashlib
import json
import logging
import os
import re
import uuid
from contextlib import asynccontextmanager, suppress

from fastapi import Depends, FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.ratelimit import rate_limit
from app.db.session import engine
from app.routers import audit, auth, bd, business_admin, delegations, design, financial_closure, launch_approval, legal, loi, notifications, nso, project, project_excellence, sites, staging, supervisor_codes, tenancy, users


# ── Structured / JSON logging ─────────────────────────────────────────
# One JSON object per log line: ts, level, logger, request_id, msg (+ exc on exceptions).
# Correlation makes log streams grep/filter-friendly.

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


def _warn_if_scaled_out() -> None:
    """Warn at startup if >1 worker/replica is configured while the rate-limiter
    store is the process-local in-memory dict.

    The limiter store (app/core/ratelimit.py) is valid ONLY for a single process
    on a single replica. With >1 worker per process each keeps its own windows.
    No Redis store exists yet, so scaling out silently weakens brute-force protection.
    Keep WEB_CONCURRENCY unset until the store is migrated to Redis.

    Detectable from inside the container: the worker count
    (WEB_CONCURRENCY / UVICORN_WORKERS). NOT detectable: horizontal *replica*
    scaling — Railway exposes per-instance ids (RAILWAY_REPLICA_ID) but no
    reliable replica *count*, so running multiple replicas can't be warned about
    here and is operationally unsupported until the store moves to Redis.
    """
    concurrency = max(
        _int_or_zero(os.getenv("WEB_CONCURRENCY")),
        _int_or_zero(os.getenv("UVICORN_WORKERS")),
    )
    if concurrency > 1:
        log.warning(
            "startup: in-memory rate limiter active but %d workers are configured "
            "(WEB_CONCURRENCY/UVICORN_WORKERS) — windows are NOT shared across "
            "processes, so the effective per-client limit is multiplied and "
            "brute-force protection is weakened (#225). Run a single worker, or "
            "migrate the limiter store to Redis before scaling out.",
            concurrency,
        )


# ── Request ID middleware ──────────────────────────────────────────────

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


# ── Security response headers ──────────────────────────────────────────

def _security_headers(request: Request) -> dict[str, str]:
    """The defense-in-depth headers added to every response. HSTS only on HTTPS
    so local http dev / health checks are unaffected (scheme is proxy-corrected
    from X-Forwarded-Proto on Railway). No Content-Security-Policy here — a CSP
    on API JSON adds no value and risks breaking calls; the SPA's CSP is applied
    at the Vercel edge (frontend/vercel.json)."""
    headers = {
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin",
    }
    if request.url.scheme == "https":
        headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return headers


async def _security_headers_dispatch(request: Request, call_next):
    """BaseHTTPMiddleware dispatch (registered via the ``dispatch=`` form, so it's
    a plain function — no unused ``self``). Adds the security headers to every
    response that passes through the user middleware stack (2xx/4xx). Only ADDS
    via setdefault — never strips — so the CORS headers set by CORSMiddleware are
    preserved. Unhandled 500s are produced by Starlette's outer
    ServerErrorMiddleware, OUTSIDE this middleware, so the exception handler
    applies the same headers there (see `_security_headers`)."""
    response = await call_next(request)
    for name, value in _security_headers(request).items():
        response.headers.setdefault(name, value)
    return response


# ── Background email drain ─────────────────────────────────────────────

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


# ── Startup migrations ────────────────────────────────────────────────────────

_MIGRATION_DIR = os.path.join(
    os.path.dirname(__file__), os.pardir, "database", "migrations"
)


def _parse_sql_statements(raw_sql: str) -> list:
    statements = []
    current_stmt = []
    in_dollar_quote = False

    for line in raw_sql.splitlines():
        if "$$" in line:
            in_dollar_quote = (line.count("$$") % 2 == 1) ^ in_dollar_quote

        if not in_dollar_quote and line.strip().endswith(";"):
            current_stmt.append(line)
            stmt_text = "\n".join(current_stmt).strip()
            if stmt_text.upper() not in ("BEGIN;", "COMMIT;"):
                statements.append(stmt_text)
            current_stmt = []
        else:
            current_stmt.append(line)

    if current_stmt and "".join(current_stmt).strip():
        stmt_text = "\n".join(current_stmt).strip()
        if stmt_text.upper() not in ("BEGIN;", "COMMIT;"):
            statements.append(stmt_text)
            
    return statements


def _file_checksum(raw_sql: str) -> str:
    """Stable content hash of a migration file, used to detect post-apply edits."""
    return hashlib.sha256(raw_sql.encode("utf-8")).hexdigest()


async def _apply_pending_migrations() -> None:
    """Apply each SQL migration file EXACTLY ONCE, tracked by a ledger table.

    Why a ledger (public.schema_migrations):
      The previous runner re-executed every ``.sql`` file on every startup.
      Most files are guarded with IF EXISTS / IF NOT EXISTS and are therefore
      idempotent, but a DROP-then-readd pair split across two files is NOT:
      202605241 dropped ``users.password_hash`` and 202606081 re-added it, so
      every boot silently wiped all bcrypt hashes. Reviewing individual DROPs
      is not a durable fix — the architecture guaranteed the bug class would
      recur. Recording what has run and skipping it is the durable fix.

    Behaviour:
      * First boot against an ALREADY-PROVISIONED database (the ledger is
        empty but core tables exist): the DB has, by definition, already had
        every current migration applied by the old always-run runner, so we
        BASELINE — record every present file as applied WITHOUT executing it.
        This is what stops the one final destructive re-run on the deploy that
        introduces the ledger. (Ship this change without bundling a brand-new
        migration in the same deploy, or the new file gets baselined unrun.)
      * Thereafter: only files absent from the ledger are executed, in sorted
        order, each statement in its own transaction; a file is recorded as
        applied only when all its statements succeed (a failing statement
        leaves it unrecorded so it retries next deploy).
      * A file already in the ledger is never re-run, even if its checksum
        changed — an edited-after-apply migration is logged, not replayed
        (fix applied migrations by adding a NEW migration file).
    """
    files_to_apply = sorted([
        f for f in os.listdir(_MIGRATION_DIR)
        if f.endswith(".sql")
    ])

    # Reuse a single connection for all migrations to avoid pool checkout overhead and DB connection limits.
    async with engine.connect() as conn:
        # ── Ledger bootstrap: create it if absent, load already-applied set. ──
        async with conn.begin():
            await conn.exec_driver_sql(
                """
                CREATE TABLE IF NOT EXISTS public.schema_migrations (
                    filename   text PRIMARY KEY,
                    checksum   text        NOT NULL,
                    applied_at timestamptz NOT NULL DEFAULT now()
                );
                """
            )
            res = await conn.exec_driver_sql(
                "SELECT filename, checksum FROM public.schema_migrations;"
            )
            applied_ledger = {row[0]: row[1] for row in res.fetchall()}

        # ── Baseline path: empty ledger on a database that already has schema. ──
        if not applied_ledger:
            # Wrap the probe in its own transaction: a bare execute would
            # auto-begin one that then collides with the begin() blocks below.
            async with conn.begin():
                res = await conn.exec_driver_sql("SELECT to_regclass('public.tenants');")
                already_provisioned = res.scalar() is not None
            if already_provisioned:
                async with conn.begin():
                    for filename in files_to_apply:
                        resolved = os.path.normpath(os.path.join(_MIGRATION_DIR, filename))
                        with open(resolved, encoding="utf-8") as fh:
                            checksum = _file_checksum(fh.read())
                        await conn.execute(
                            text(
                                "INSERT INTO public.schema_migrations (filename, checksum) "
                                "VALUES (:f, :c) ON CONFLICT (filename) DO NOTHING"
                            ),
                            {"f": filename, "c": checksum},
                        )
                log.warning(
                    "startup-migrations: BASELINED %d existing migration(s) on an "
                    "already-provisioned database — none were re-executed. This is the "
                    "one-time adoption that stops destructive re-runs (e.g. the "
                    "password_hash wipe). New migration files added after this deploy "
                    "will apply normally.",
                    len(files_to_apply),
                )
                return
            log.info(
                "startup-migrations: empty ledger and no existing schema detected — "
                "treating as a fresh database and applying all migrations once."
            )

        # ── Incremental apply: run only files not already in the ledger. ──
        applied_total = 0
        newly_applied = 0
        for filename in files_to_apply:
            resolved = os.path.normpath(os.path.join(_MIGRATION_DIR, filename))
            if not os.path.isfile(resolved):
                log.error("startup-migrations: %s not found. Failing startup to prevent inconsistent schema state.", resolved)
                raise FileNotFoundError(f"Missing required migration file: {resolved}")

            with open(resolved, encoding="utf-8") as fh:
                raw_sql = fh.read()
            checksum = _file_checksum(raw_sql)

            if filename in applied_ledger:
                if applied_ledger[filename] != checksum:
                    log.warning(
                        "startup-migrations: %s is already applied but its content "
                        "changed since — NOT re-running. Edit applied migrations only "
                        "by adding a new migration file.",
                        filename,
                    )
                continue

            statements = _parse_sql_statements(raw_sql)

            applied = 0
            file_failed = False
            for stmt in statements:
                if not stmt:
                    continue
                try:
                    # Each statement in its own transaction on the shared connection.
                    async with conn.begin():
                        await conn.exec_driver_sql(stmt)
                    applied += 1
                    applied_total += 1
                except SQLAlchemyError:
                    file_failed = True
                    log.exception(
                        "startup-migrations: statement failed in %s: %.120s",
                        filename,
                        stmt,
                    )

            if file_failed:
                log.error(
                    "startup-migrations: %s had failing statement(s); NOT recording as "
                    "applied — it will be retried on the next deploy.",
                    filename,
                )
                continue

            async with conn.begin():
                await conn.execute(
                    text(
                        "INSERT INTO public.schema_migrations (filename, checksum) "
                        "VALUES (:f, :c) ON CONFLICT (filename) "
                        "DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = now()"
                    ),
                    {"f": filename, "c": checksum},
                )
            newly_applied += 1
            log.info("startup-migrations: applied %s (%d statement(s))", filename, applied)

        log.info(
            "startup-migrations: %d new migration file(s), %d statement(s) applied; %d already in ledger",
            newly_applied,
            applied_total,
            len(applied_ledger),
        )


async def _verify_schema():
    """Verify that required schema changes exist to prevent runtime 500s on pipeline creation.

    Checks constraint *content* (not constraint *names*) because the production
    DB may have auto-generated names from inline CREATE TABLE definitions that
    differ from the explicit names used in migration ALTER TABLE statements.
    """
    async with engine.connect() as conn:
        # 1. Verify all required sites columns exist
        required_columns = {
            'area_sqft', 'staggered_escalation', 'google_maps_url',
            'expected_rent', 'rent_type', 'expected_escalation_pct',
            'expected_escalation_years', 'expected_revshare_pct', 'rent_set_at'
        }
        res = await conn.execute(text("""
            SELECT column_name
            FROM information_schema.columns
            WHERE table_name = 'sites';
        """))
        cols = {row[0] for row in res.fetchall()}
        missing = required_columns - cols
        if missing:
            log.critical("Database schema is outdated. Missing sites columns: %s. Run latest migrations before deploying.", ', '.join(missing))
            raise SystemExit(1)

        # 2. Verify sites.model is 'text' and not USER-DEFINED
        res = await conn.execute(text("""
            SELECT data_type
            FROM information_schema.columns
            WHERE table_name = 'sites' AND column_name = 'model';
        """))
        row = res.fetchone()
        if not row or row[0] != 'text':
            log.critical("Database schema is outdated. sites.model must be TEXT, not a PostgreSQL enum. Run latest migrations before deploying.")
            raise SystemExit(1)

        # 3. Verify some CHECK constraint on sites includes 'staggered' for rent_type
        #    (don't query by constraint name — production may use auto-generated names)
        res = await conn.execute(text("""
            SELECT pg_get_constraintdef(c.oid)
            FROM pg_constraint c
            JOIN pg_class t ON c.conrelid = t.oid
            WHERE t.relname = 'sites' AND c.contype = 'c';
        """))
        all_checks = [row[0] for row in res.fetchall()]
        if not any("'staggered'" in chk for chk in all_checks):
            log.critical("Database schema is outdated. No CHECK constraint on sites includes 'staggered'. Constraints found: %s", all_checks)
            raise SystemExit(1)

    log.info("Schema verification passed: sites columns present, model=text, rent_type includes staggered.")


# ── Application lifespan ──────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Smoke-test the DB — FAIL FAST so health-checks can detect a failure early.
    # Previously, a deploy with a bad DATABASE_URL would boot but fail on requests.
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
            log.info("startup: database connection OK")
    except Exception as exc:
        log.exception(
            "startup: database connection failed — exiting so Railway restarts: %s", exc
        )
        raise SystemExit(1) from exc  # triggers ON_FAILURE restart

    # ── Apply pending migrations idempotently.
    await _apply_pending_migrations()

    # ── Verify required schema matches expectations
    await _verify_schema()

    # Warn (don't fail) if the deployment scales out past the single-process
    # invariant the in-memory rate limiter relies on (#225, 3.2).
    _warn_if_scaled_out()

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
# Added after CORS (so it wraps it): only adds headers, never strips, so CORS —
# including the error-path re-application — is preserved (#227).
app.add_middleware(BaseHTTPMiddleware, dispatch=_security_headers_dispatch)
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
        # Unhandled 500s are produced outside the user middleware stack, so apply
        # the security headers (and re-apply CORS, #117) here too (#227).
        headers={**_cors_headers_for(request), **_security_headers(request), "X-Request-Id": rid},
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
    Rate-limited: each call burns a pgBouncer slot round-trip."""
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return {"status": "ok"}
