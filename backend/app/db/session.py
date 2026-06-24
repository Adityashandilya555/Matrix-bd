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
    # Supabase's transaction pooler (pgBouncer, transaction mode) does not support
    # prepared statements. Disable the asyncpg statement cache and use NullPool
    # when connecting through the pooler URL.
    is_pooler = ":6543/" in database_url or "pooler.supabase.com" in database_url

    # asyncpg defaults are wait-forever; cap both query and connection establishment
    # so a stuck query doesn't hold a pooler slot indefinitely.
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

    Commits any open transaction on success; rolls back on exception.
    The explicit commit is a safety net for read transactions auto-begun by
    per-request middleware (e.g. is_active check) that `transaction()` wraps
    in a SAVEPOINT, which does not commit the outer transaction on its own.
    """
    session = SessionLocal()
    try:
        yield session
        if session.in_transaction():
            await session.commit()
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
