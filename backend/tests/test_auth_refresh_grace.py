"""Regression tests for the bounded-grace /auth/refresh decode path.

Context: a prior security sweep made get_current_user re-check the DB and made
every authed route 401 on an expired/invalidated JWT, and /auth/refresh ran
through the SAME strict decode — so a lapsed token could not self-heal. That
single 401 surfaced as BOTH the "session paused" popup AND "pipeline not
created". The fix adds decode_token_for_refresh, which tolerates a token expired
within REFRESH_GRACE_SECONDS so a recently-lapsed session re-mints silently,
while STILL verifying signature/audience/claims and rejecting anything expired
beyond the grace window. These tests lock that behavior in so it can't regress.
"""
from __future__ import annotations

import uuid

import pytest

from app.core.security import (
    REFRESH_GRACE_SECONDS,
    AuthError,
    decode_token,
    decode_token_for_refresh,
    issue_token,
)


def _token(ttl_seconds: int) -> str:
    """Mint a token whose exp is now+ttl_seconds (negative ttl => already expired)."""
    return issue_token(
        sub=str(uuid.uuid4()),
        email="exec@example.com",
        name="Exec",
        role="executive",
        tenant_id=str(uuid.uuid4()),
        city="Mumbai",
        ttl_seconds=ttl_seconds,
    )


def test_refresh_decode_accepts_recently_expired_token():
    # Expired one hour ago — well within the grace window.
    claims = decode_token_for_refresh(_token(-3600))
    assert claims["role"] == "executive"
    assert claims["sub"]


def test_refresh_decode_accepts_still_valid_token():
    claims = decode_token_for_refresh(_token(3600))
    assert claims["role"] == "executive"


def test_refresh_decode_rejects_token_expired_beyond_grace():
    # Expired an hour past the grace window — must NOT be refreshable, or a
    # long-dead (e.g. stolen) token could be resurrected forever.
    with pytest.raises(AuthError) as exc:
        decode_token_for_refresh(_token(-(REFRESH_GRACE_SECONDS + 3600)))
    assert exc.value.status_code == 401


def test_refresh_decode_still_verifies_signature():
    # Tampering with the token must fail even on the grace path.
    with pytest.raises(AuthError) as exc:
        decode_token_for_refresh(_token(-3600) + "tamper")
    assert exc.value.status_code == 401


def test_strict_decode_still_rejects_expired_token():
    # The normal request path (decode_token) must remain strict: a token that is
    # refreshable within grace is still 401 for any non-refresh route.
    with pytest.raises(AuthError) as exc:
        decode_token(_token(-3600))
    assert exc.value.status_code == 401


# ── #228 — tighten the grace window from 7 days to 48 hours ────────────────
# The 7-day window let a leaked/stale token mint a fresh session for up to ~8
# days after visible expiry. 48h keeps the overnight/weekend self-heal while
# cutting the stolen-token tail to ~3 days. Pin the boundary so it can't widen.
_DAY = 60 * 60 * 24


def test_refresh_grace_window_capped_at_48h():
    # PROVE-FIRST: pre-fix this was 7 days and the assertion fails.
    assert REFRESH_GRACE_SECONDS <= 2 * _DAY


def test_refresh_accepts_token_expired_1_day():
    # In-window self-heal must keep working (overnight/weekend tab left open).
    claims = decode_token_for_refresh(_token(-_DAY))
    assert claims["role"] == "executive"


def test_refresh_rejects_token_expired_3_days():
    # PROVE-FIRST: pre-fix (7-day window) a 3-day-old token still refreshed;
    # after the 48h tightening it must be rejected.
    with pytest.raises(AuthError) as exc:
        decode_token_for_refresh(_token(-3 * _DAY))
    assert exc.value.status_code == 401
