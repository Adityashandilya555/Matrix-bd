"""Application configuration — typed env loading via pydantic-settings.

Reads the project `.env` file by default; can be overridden by exporting the
env vars. The defaults make the app *startable* for local dev but every
production value (DATABASE_URL, SUPABASE_JWT_SECRET, SUPABASE_SERVICE_ROLE_KEY)
must be set in the deployment environment.
"""
from __future__ import annotations

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# Repo-committed placeholder values. Booting with either of these outside an
# explicit insecure-dev mode is a takeover waiting to happen (#80): the JWT
# secret makes every token forgeable; the admin password is public history.
_PLACEHOLDER_JWT_SECRET = "change-me-in-production"  # noqa: S105 # nosec B105 — sentinel, rejected at boot
_RETIRED_ADMIN_PASSWORD = "BlueTokai-Matrix-2026"  # noqa: S105 # nosec B105 — old default, rejected at boot


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── App ─────────────────────────────────────────────────────────────────
    app_name: str = "Scale BD Platform"
    api_prefix: str = "/api"
    debug: bool = False
    log_level: str = "INFO"

    # Explicit opt-in for local development with placeholder secrets and other
    # insecure conveniences. NEVER set in production — the startup guard below
    # is the only thing standing between a missing env var and forgeable JWTs.
    allow_insecure_defaults: bool = False
    # Serve /api/docs + /api/openapi.json. Off by default: the schema hands an
    # attacker the full endpoint map, auth header names, and signup-code
    # semantics (#111). Enable locally via ENABLE_DOCS=true.
    enable_docs: bool = False

    # CORS_ORIGINS comes in as a comma-separated string in .env; split below.
    cors_origins: str = "http://localhost:5173,http://localhost:3000,https://www.retailexpansion.in,https://retailexpansion.in"
    # Optional regex applied in addition to cors_origins — lets us whitelist a
    # whole pattern of preview URLs (e.g. Vercel's per-commit previews:
    # CORS_ORIGIN_REGEX=^https://<project>-[a-z0-9-]+\.vercel\.app$).
    # Starlette matches allow_origins by EXACT string compare, so glob entries
    # in CORS_ORIGINS silently never match — the regex is the only correct way
    # to allow preview URLs (#110).
    cors_origin_regex: str = ""
    # Opt-in for local Vite ports (5100-5199). Previously this regex was baked
    # in unconditionally, leaving http://localhost:51xx a permanently allowed
    # origin against the production API (#110).
    cors_allow_localhost: bool = False

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def effective_cors_origin_regex(self) -> str:
        if self.cors_origin_regex:
            return self.cors_origin_regex
        if self.cors_allow_localhost:
            return r"^http://(localhost|127\.0\.0\.1):51[0-9]{2}$"
        return ""

    # ── Database ────────────────────────────────────────────────────────────
    database_url: str = Field(
        "postgresql+asyncpg://postgres:postgres@localhost:5432/postgres",
        description="async SQLAlchemy URL — must use the asyncpg driver",
    )
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_pool_recycle_seconds: int = 300
    # asyncpg timeouts (both pgBouncer-safe). Without them asyncpg waits
    # forever, so one stuck query or connection pins a pooler slot indefinitely
    # and cascades into pool exhaustion under load (#90).
    db_command_timeout_seconds: float = 30.0
    db_connect_timeout_seconds: float = 10.0

    # ── Auth ────────────────────────────────────────────────────────────────
    supabase_jwt_secret: str = _PLACEHOLDER_JWT_SECRET
    supabase_jwt_audience: str = "authenticated"
    allow_anon_demo_user: bool = False
    # Comma-separated workspace codes whose users may sign in WITHOUT a
    # password (demo/sample tenants only, e.g. SAMPLE-8513). Everyone else:
    # an account with no password_hash can no longer log in (#83) — it must
    # set one through the admin-approved, token-bound reset flow (#85).
    passwordless_demo_codes: str = ""

    @property
    def passwordless_demo_code_list(self) -> list[str]:
        return [c.strip().upper() for c in self.passwordless_demo_codes.split(",") if c.strip()]

    # ── Storage ─────────────────────────────────────────────────────────────
    supabase_project_url: str = ""
    supabase_service_role_key: str = ""
    supabase_storage_bucket: str = "site-files"
    # Hard cap (bytes) on any single uploaded file. Without it every upload
    # endpoint buffered the whole body in RAM uncapped — a few large/malicious
    # uploads OOM the backend and drop all sessions (#93). 25 MB covers LOI
    # PDFs, site photos, quality-audit reports, and branding logos.
    max_upload_bytes: int = 25 * 1024 * 1024

    # ── Email (Resend) ──────────────────────────────────────────────────────
    # Set RESEND_API_KEY to enable the in-process notification drain (#112).
    # Without it, email rows accumulate in notification_outbox and are never sent.
    resend_api_key: str = ""
    resend_from_email: str = "Matrix <noreply@matrix.bluetokai.com>"
    # How often the drain loop runs (seconds). 30s keeps latency low without
    # hammering the DB or Resend rate limits.
    notification_drain_interval_secs: int = 30

    # ── Platform admin (workspace-request approval) ─────────────────────────
    # The portal at /admin uses an email + password pair set via env. On
    # successful login the backend hands back `platform_admin_token` and the
    # SPA puts it in the X-Platform-Admin-Key header on every subsequent
    # request. There is NO default password (#80): if PLATFORM_ADMIN_PASSWORD
    # is unset the portal returns 503 instead of accepting a repo-committed
    # string anyone can read.
    platform_admin_email:    str = "admin@matrix.bluetokai.com"
    platform_admin_password: str = ""
    # If left blank, the runtime falls back to platform_admin_password so the
    # whole flow works out of the box. Set explicitly only if you want the
    # human-typed password to differ from the per-request header token.
    platform_admin_token:    str = ""

    @property
    def effective_platform_admin_password(self) -> str:
        """The admin password actually honored. The retired repo-committed
        default is treated as UNSET (#80) — it is public git history, so the
        portal is disabled (503) rather than accepting it. This disables the
        portal instead of bricking the whole API, so a stale env var can't take
        the backend down on deploy."""
        if self.platform_admin_password == _RETIRED_ADMIN_PASSWORD:
            return ""
        return self.platform_admin_password

    @property
    def effective_platform_admin_token(self) -> str:
        token = self.platform_admin_token
        if token == _RETIRED_ADMIN_PASSWORD:
            token = ""  # nosec B105 — clearing a retired credential, not setting one
        return token or self.effective_platform_admin_password

    # ── Startup guard (#80, #110) ────────────────────────────────────────────
    @model_validator(mode="after")
    def _refuse_insecure_production_config(self) -> "Settings":
        import logging

        log = logging.getLogger("matrix.config")

        # JWT secret is the one hard stop: booting with the public placeholder
        # makes every token forgeable (full auth bypass), which is strictly
        # worse than refusing to start. Prod sets a real secret, so this never
        # trips there; local dev opts in via ALLOW_INSECURE_DEFAULTS.
        if not self.allow_insecure_defaults and self.supabase_jwt_secret == _PLACEHOLDER_JWT_SECRET:
            raise RuntimeError(
                "Refusing to start: SUPABASE_JWT_SECRET is the repo-committed placeholder — "
                "every JWT would be forgeable with a public key. Set the real secret "
                "(or ALLOW_INSECURE_DEFAULTS=true for local dev)."
            )

        # ALLOW_ANON_DEMO_USER authenticates a header-less request as an
        # executive (deps.py) — unauthenticated role-gated access. Like the JWT
        # placeholder it must be confined to insecure-dev mode; nothing else
        # bound it before (#224). Prod never sets it, so prod is unaffected;
        # legitimate local UI-driving already runs with ALLOW_INSECURE_DEFAULTS
        # =true (placeholder secret), so existing dev workflows keep working.
        if self.allow_anon_demo_user and not self.allow_insecure_defaults:
            raise RuntimeError(
                "Refusing to start: ALLOW_ANON_DEMO_USER=true requires "
                "ALLOW_INSECURE_DEFAULTS=true (local dev only) — it grants "
                "unauthenticated executive access."
            )

        # The retired admin password is handled by effective_platform_admin_*
        # (portal disabled, not a boot failure) — warn loudly so it gets fixed.
        if self.platform_admin_password == _RETIRED_ADMIN_PASSWORD or self.platform_admin_token == _RETIRED_ADMIN_PASSWORD:
            log.error(
                "PLATFORM_ADMIN_PASSWORD/TOKEN is the retired repo-committed default "
                "(public git history). The admin portal is DISABLED until a real one is set."
            )

        # Wildcard origin + allow_credentials reflects ANY Origin back with
        # credentials allowed — every site on the internet could drive a
        # logged-in operator's browser against the API (#110). Strip it (so the
        # app still boots) rather than refuse to start, and warn.
        if any(o == "*" for o in self.cors_origin_list):
            kept = [o for o in self.cors_origin_list if o != "*"]
            self.cors_origins = ",".join(kept)
            log.error(
                "CORS_ORIGINS contained '*' with credentials enabled — the wildcard was "
                "DROPPED (it would let any website call the API with credentials). List exact "
                "origins, or use CORS_ORIGIN_REGEX for preview URLs. Remaining: %s",
                kept or "(none — the frontend origin must be added)",
            )
        return self


settings = Settings()
