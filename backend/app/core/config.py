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
    app_name: str = "Z-Matrix BD Platform"
    api_prefix: str = "/api"
    debug: bool = False
    log_level: str = "INFO"

    # CORS_ORIGINS comes in as a comma-separated string in .env; split below.
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

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


settings = Settings()
