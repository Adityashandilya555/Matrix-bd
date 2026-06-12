"""Shared pytest fixtures + a lightweight AsyncSession stand-in.

The ORM models are heavily Postgres-specific (UUID/JSONB/CHECK constraints,
server-side ``uuid_generate_v4()`` defaults), so a SQLite ``create_all`` harness
is fragile. Instead these tests validate service/router behaviour with:

* pure constructor / helper unit tests (no DB), and
* ``RecordingSession`` — a minimal async stand-in that records the SQL it was
  asked to execute and returns *queued* canned results.

That is enough to assert the things the bug-fix PRs care about: the *shape* of
the SQL emitted (``ON CONFLICT``, ``ORDER BY``, ``notes = NULL`` …), the call
ordering (upload before transaction), and that errors translate to the right
HTTP status. Each test is written to FAIL on the pre-fix code and PASS after.
"""
from __future__ import annotations

import contextlib
import os
from typing import Any

import pytest

# The settings object refuses to instantiate with the placeholder JWT secret
# unless dev mode is explicit (#80). Tests are exactly that.
os.environ.setdefault("ALLOW_INSECURE_DEFAULTS", "true")


class FakeResult:
    """Stand-in for a SQLAlchemy ``Result``.

    Configure exactly the accessor a query uses: ``scalar_one_or_none`` for a
    single ORM row, ``scalars().all()`` for a list, ``all()`` for tuple rows.
    """

    def __init__(
        self,
        *,
        scalar: Any = None,
        scalars_list: list[Any] | None = None,
        all_rows: list[Any] | None = None,
        mappings_rows: list[Any] | None = None,
    ) -> None:
        self._scalar = scalar
        self._scalars_list = scalars_list if scalars_list is not None else []
        self._all_rows = all_rows if all_rows is not None else []
        self._mappings_rows = mappings_rows if mappings_rows is not None else []

    def scalar_one_or_none(self) -> Any:
        return self._scalar

    def scalar_one(self) -> Any:
        return self._scalar

    def scalar(self) -> Any:
        return self._scalar

    def scalars(self) -> "FakeScalars":
        return FakeScalars(self._scalars_list)

    def all(self) -> list[Any]:
        return self._all_rows

    def first(self) -> Any:
        return self._all_rows[0] if self._all_rows else None

    def mappings(self) -> "FakeScalars":
        # FakeScalars exposes .all()/.first(), which is the same surface
        # `.mappings()` callers use.
        return FakeScalars(self._mappings_rows)


class FakeScalars:
    def __init__(self, items: list[Any]) -> None:
        self._items = items

    def all(self) -> list[Any]:
        return self._items

    def first(self) -> Any:
        return self._items[0] if self._items else None


class RecordingSession:
    """A minimal stand-in for ``AsyncSession`` — records, never touches a DB."""

    def __init__(self, results: list[Any] | None = None) -> None:
        self.executed: list[str] = []          # compiled SQL strings
        self.executed_raw: list[Any] = []       # the statement objects
        self.execute_params: list[Any] = []     # the bound params, if any
        self.added: list[Any] = []
        self.deleted: list[Any] = []
        self.flush_count = 0
        self.commit_count = 0
        self.rollback_count = 0
        self.refreshed: list[Any] = []
        self._results: list[Any] = list(results or [])
        self._in_txn = False

    # -- query side -------------------------------------------------------
    async def execute(self, stmt: Any, params: Any = None, *a: Any, **k: Any) -> Any:
        self.executed_raw.append(stmt)
        self.execute_params.append(params)
        try:
            self.executed.append(str(stmt))
        except Exception:  # pragma: no cover - defensive
            self.executed.append(repr(stmt))
        if self._results:
            return self._results.pop(0)
        return FakeResult()

    def queue(self, *results: Any) -> "RecordingSession":
        self._results.extend(results)
        return self

    # -- unit-of-work side ------------------------------------------------
    async def flush(self) -> None:
        self.flush_count += 1

    async def commit(self) -> None:
        self.commit_count += 1

    async def rollback(self) -> None:
        self.rollback_count += 1

    async def refresh(self, obj: Any, *a: Any, **k: Any) -> None:
        self.refreshed.append(obj)

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    def delete(self, obj: Any) -> None:
        self.deleted.append(obj)

    # -- transaction helper plumbing -------------------------------------
    def in_transaction(self) -> bool:
        return self._in_txn

    def begin(self):
        session = self

        @contextlib.asynccontextmanager
        async def _cm():
            session._in_txn = True
            try:
                yield session
                session.commit_count += 1
            except Exception:
                session.rollback_count += 1
                raise
            finally:
                session._in_txn = False

        return _cm()

    def begin_nested(self):
        return self.begin()

    # -- convenience ------------------------------------------------------
    @property
    def sql(self) -> str:
        return "\n".join(self.executed)


@pytest.fixture
def session() -> RecordingSession:
    return RecordingSession()


@pytest.fixture
def make_session():
    def _factory(*results: Any) -> RecordingSession:
        return RecordingSession(list(results))

    return _factory


@pytest.fixture
def fake_result():
    """The ``FakeResult`` class, so tests can queue canned query results."""
    return FakeResult
