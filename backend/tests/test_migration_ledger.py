"""Regression guards for the startup migration runner.

Context: the runner in app/main.py used to re-execute EVERY .sql file on EVERY
boot. Migration 202605241 dropped ``users.password_hash`` and 202606081 re-added
it, so each restart silently wiped every bcrypt hash. The fix is two-fold:

  1. A ledger table (public.schema_migrations) makes each file run exactly once.
  2. No migration may DROP ``users.password_hash`` again.

These tests lock in both so the wipe cannot silently return.
"""
import os
import re

import pytest
from sqlalchemy import text

from app.db import engine
from app.main import _MIGRATION_DIR, _apply_pending_migrations


def _migration_files() -> list[str]:
    return sorted(f for f in os.listdir(_MIGRATION_DIR) if f.endswith(".sql"))


# ── Hermetic guard: the exact column that got wiped can never be dropped again ──

def test_no_migration_drops_users_password_hash():
    """No migration file may DROP users.password_hash.

    This is the precise statement (in 202605241) that, combined with the
    re-ADD in 202606081, wiped every password on restart.
    """
    offenders = []
    for filename in _migration_files():
        with open(os.path.join(_MIGRATION_DIR, filename), encoding="utf-8") as fh:
            sql = fh.read()
        # Strip line comments so a commented-out DROP doesn't trip the guard.
        sql_no_comments = re.sub(r"--[^\n]*", "", sql)
        if re.search(
            r"drop\s+column\s+(if\s+exists\s+)?password_hash",
            sql_no_comments,
            re.IGNORECASE,
        ):
            offenders.append(filename)
    assert not offenders, (
        "These migrations DROP users.password_hash and would wipe all passwords "
        f"on restart: {offenders}. Never drop this column."
    )


# ── DB-backed guard: the runner is ledger-based and applies each file once ──

@pytest.mark.asyncio
async def test_runner_records_ledger_and_is_idempotent():
    """After running, every migration is recorded once and a second run is a no-op.

    Non-destructive against a provisioned DB: the runner either baselines the
    existing schema or finds every file already in the ledger, so it changes no
    application data. Skips when no database is reachable (repo convention).
    """
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 — mirror test_migration.py's skip pattern
        pytest.skip(f"Database connection unavailable: {exc}")

    await _apply_pending_migrations()

    async def _ledger_filenames() -> set[str]:
        async with engine.connect() as conn:
            res = await conn.execute(
                text("SELECT filename FROM public.schema_migrations")
            )
            return {row[0] for row in res.fetchall()}

    on_disk = set(_migration_files())
    after_first = await _ledger_filenames()
    assert on_disk.issubset(after_first), (
        "Every migration file must be recorded in the ledger after a run; "
        f"missing: {on_disk - after_first}"
    )

    # Second run must not error and must not change the recorded set — proves
    # applied migrations are never re-executed.
    await _apply_pending_migrations()
    after_second = await _ledger_filenames()
    assert after_second == after_first
