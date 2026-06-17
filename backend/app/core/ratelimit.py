"""Tiny in-process rate limiter for the unauthenticated public endpoints (#109).

A fixed-size sliding window keyed by (client IP, route path). Deliberately
dependency-free and in-memory: the backend runs as a single Railway instance,
so a process-local limiter is sufficient to stop wire-speed brute force of
workspace codes / passwords / reset tokens and queue-flooding bots. If the
deployment ever scales horizontally, swap the store for Redis — the dependency
interface stays the same.

Usage::

    @router.post("/login", dependencies=[Depends(rate_limit(times=10, seconds=60))])
"""
from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Callable, Deque, Dict, Tuple

from fastapi import HTTPException, Request, status

# (ip, path) → timestamps of recent requests. Bounded per key by `times`,
# and stale keys are pruned opportunistically to keep memory flat.
_WINDOWS: Dict[Tuple[str, str], Deque[float]] = defaultdict(deque)
# Last opportunistic-prune timestamp, held in a one-element list so `_prune` can
# update it without a module-level `global` rebind (#238). Single event loop, so
# the read-then-write is effectively atomic per process.
_PRUNE_STATE: list[float] = [0.0]


def _client_ip(request: Request) -> str:
    # Railway terminates TLS in front of us; the original client lands in
    # X-Forwarded-For (first hop). Fall back to the socket peer for local dev.
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _prune(now: float, horizon: float) -> None:
    if now - _PRUNE_STATE[0] < 60:
        return
    _PRUNE_STATE[0] = now
    stale = [k for k, dq in _WINDOWS.items() if not dq or now - dq[-1] > horizon]
    for k in stale:
        _WINDOWS.pop(k, None)


def rate_limit(*, times: int, seconds: int) -> Callable:
    """Dependency factory: allow at most `times` requests per `seconds` per
    client IP for the route it guards; raises 429 beyond that."""

    async def guard(request: Request) -> None:
        now = time.monotonic()
        key = (_client_ip(request), request.scope.get("path", ""))
        window = _WINDOWS[key]
        cutoff = now - seconds
        while window and window[0] < cutoff:
            window.popleft()
        if len(window) >= times:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please wait a moment and try again.",
                headers={"Retry-After": str(seconds)},
            )
        window.append(now)
        _prune(now, horizon=float(seconds) * 2)

    return guard
