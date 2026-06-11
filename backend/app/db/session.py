"""Async SQLAlchemy engine + sessionmaker for Supabase Postgres.

The engine is built once at import time using settings from `app.core.config`.
Routes consume sessions through the `get_db` dependency.

Notes on Supabase:
- Use the *transaction pooler* URL (port 6543), not the direct connection,
  for serverless/long-running workloads. Set DATABASE_URL accordingly.
- The driver MUST be `postgresql+asyncpg`. Supabase URIs come as
  `postgres://…` — swap the scheme manually in your .env.
- Tenant scoping is enforced in application code (see services). RLS can be
  layered on top if you also want database-side enforcement; the queries we
  emit are RLS-safe (always include tenant_id in the WHERE clause).
"""
from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.core.config import settings


def _build_engine_kwargs(database_url: str) -> dict:
    # Supabase's transaction pooler is pgBouncer in transaction mode, which
    # does NOT support prepared statements. The documented fix when going
    # through pgBouncer is:
    #   1. Disable asyncpg's statement cache (statement_cache_size=0)
    #   2. Use SQLAlchemy NullPool so we don't reuse connections across
    #      transactions (pgBouncer assigns a different backend per txn anyway,
    #      and SQLAlchemy's own pool would hand out connections that
    #      already-cached statements at the asyncpg layer).
    is_pooler = ":6543/" in database_url or "pooler.supabase.com" in database_url

    # asyncpg connect_args. `command_timeout` caps any single query and
    # `timeout` caps connection establishment — both pgBouncer-safe. asyncpg's
    # defaults are *wait forever*, so without these one stuck query holds its
    # connection (and pooler slot) indefinitely and the app stalls under load.
    connect_args: dict = {
        "command_timeout": settings.db_command_timeout_seconds,
        "timeout": settings.db_connect_timeout_seconds,
    }
    kwargs: dict = {
        "echo": settings.debug,
    }
    if is_pooler:
        kwargs["poolclass"]   = NullPool
        connect_args["statement_cache_size"] = 0
    else:
        kwargs["pool_size"]       = settings.db_pool_size
        kwargs["max_overflow"]    = settings.db_max_overflow
        kwargs["pool_pre_ping"]   = True
        kwargs["pool_recycle"]    = settings.db_pool_recycle_seconds
    kwargs["connect_args"] = connect_args
    return kwargs


def _make_engine() -> AsyncEngine:
    return create_async_engine(settings.database_url, **_build_engine_kwargs(settings.database_url))


engine: AsyncEngine = _make_engine()

SessionLocal: async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency yielding an `AsyncSession`.

    The session is rolled back if an exception escapes the route and is closed
    in all cases. Services either commit at their own boundary or use the
    `transaction()` helper below.
    """
    session = SessionLocal()
    try:
        yield session
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


@asynccontextmanager
async def transaction(session: AsyncSession) -> AsyncGenerator[AsyncSession, None]:
    """Begin a (nested-safe) transaction. Commits on exit if no exception."""
    if session.in_transaction():
        async with session.begin_nested():
            yield session
    else:
        async with session.begin():
            yield session
