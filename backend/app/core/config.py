"""Application configuration — typed env loading via pydantic-settings.

Reads the project `.env` file by default; can be overridden by exporting the
env vars. The defaults make the app *startable* for local dev but every
production value (DATABASE_URL, SUPABASE_JWT_SECRET, SUPABASE_SERVICE_ROLE_KEY)
must be set in the deployment environment.
"""
from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # CORS_ORIGINS comes in as a comma-separated string in .env; split below.
    cors_origins: str = "http://localhost:5173,http://localhost:3000"
    # Optional regex applied in addition to cors_origins — lets us whitelist a
    # whole pattern of preview URLs (e.g. Vercel's per-commit previews) without
    # listing each one. By default, keep local Vite preview ports usable even
    # when production CORS_ORIGINS is narrowed to the deployed Vercel domain.
    cors_origin_regex: str = r"^http://(localhost|127\.0\.0\.1):51[0-9]{2}$"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    # ── Database ────────────────────────────────────────────────────────────
    database_url: str = Field(
        "postgresql+asyncpg://postgres:postgres@localhost:5432/postgres",
        description="async SQLAlchemy URL — must use the asyncpg driver",
    )
    db_pool_size: int = 5
    db_max_overflow: int = 10
    db_pool_recycle_seconds: int = 300

    # ── Auth ────────────────────────────────────────────────────────────────
    supabase_jwt_secret: str = "change-me-in-production"
    supabase_jwt_audience: str = "authenticated"
    allow_anon_demo_user: bool = False

    # ── Storage ─────────────────────────────────────────────────────────────
    supabase_project_url: str = ""
    supabase_service_role_key: str = ""
    supabase_storage_bucket: str = "site-files"

    # ── Platform admin (workspace-request approval) ─────────────────────────
    # The portal at /admin uses a baked-in email + password pair (overridable
    # via env). On successful login the backend hands back `platform_admin_token`
    # and the SPA puts it in the X-Platform-Admin-Key header on every subsequent
    # request. So one set of env vars covers both the human-typed credentials
    # and the machine-checked secret behind the routes.
    #
    # Defaults are stable but easily rotatable — set PLATFORM_ADMIN_PASSWORD in
    # production env to anything else.
    platform_admin_email:    str = "admin@matrix.bluetokai.com"
    platform_admin_password: str = "BlueTokai-Matrix-2026"
    # If left blank, the runtime falls back to platform_admin_password so the
    # whole flow works out of the box. Set explicitly only if you want the
    # human-typed password to differ from the per-request header token.
    platform_admin_token:    str = ""

    @property
    def effective_platform_admin_token(self) -> str:
        return self.platform_admin_token or self.platform_admin_password


settings = Settings()
