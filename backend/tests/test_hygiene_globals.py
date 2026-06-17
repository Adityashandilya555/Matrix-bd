"""#238 — the two `global` rebinds were removed without changing behaviour.

`ratelimit._prune` and `storage_service.get/aclose_storage_client` previously
rebound module-level names via `global`. They now mutate a small container so the
`global` statement is gone (PLW0603) with identical behaviour. These tests lock
both the absence of `global` and the preserved behaviour.
"""
from __future__ import annotations

import inspect

import pytest


def test_no_global_statement_in_refactored_functions():
    from app.core import ratelimit
    from app.services import storage_service

    assert "global " not in inspect.getsource(ratelimit._prune)
    storage_src = (
        inspect.getsource(storage_service.get_storage_client)
        + inspect.getsource(storage_service.aclose_storage_client)
    )
    assert "global " not in storage_src


def test_ratelimit_prune_dedups_within_60s_via_container():
    from app.core import ratelimit

    ratelimit._PRUNE_STATE[0] = 0.0
    ratelimit._prune(100.0, 3600.0)
    assert ratelimit._PRUNE_STATE[0] == 100.0   # first call stamps the time
    ratelimit._prune(130.0, 3600.0)
    assert ratelimit._PRUNE_STATE[0] == 100.0   # within 60s → no-op (unchanged)
    ratelimit._prune(200.0, 3600.0)
    assert ratelimit._PRUNE_STATE[0] == 200.0   # past 60s → re-stamps


@pytest.mark.asyncio
async def test_storage_client_holder_reuse_and_reset():
    from app.services import storage_service

    c1 = storage_service.get_storage_client()
    assert storage_service.get_storage_client() is c1   # lazy singleton reused
    await storage_service.aclose_storage_client()
    assert storage_service._holder.client is None       # closed + forgotten
