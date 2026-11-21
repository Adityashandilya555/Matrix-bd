"""Webhook body serialisation and HMAC signatures.

Signature: ``v1=<hex HMAC-SHA256(secret, f"{timestamp}.{raw_body}")>``. During a
secret rotation the header carries one ``v1=`` entry per valid secret, comma
separated; the receiver accepts if any matches. ``verify`` is the reference
receiver check, used by the tests and quoted in the receiver guide.
"""
from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any, Iterable

TOLERANCE_SECS = 300
USER_AGENT = "Matrix-Webhooks/1"


def canonical_body(envelope: dict[str, Any]) -> bytes:
    """The exact bytes that are signed and sent."""
    return json.dumps(envelope, separators=(",", ":"), sort_keys=True, ensure_ascii=False).encode()


def sign(secret: str, timestamp: int, body: bytes) -> str:
    """Hex HMAC-SHA256 of ``f"{timestamp}.{body}"``."""
    return hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()


def signature_header(secrets: Iterable[str], timestamp: int, body: bytes) -> str:
    """``v1=<sig>[,v1=<sig>]`` — one entry per currently valid secret."""
    return ",".join(f"v1={sign(s, timestamp, body)}" for s in secrets)


def build_headers(*, event_id: str, event_type: str, timestamp: int, body: bytes, secrets: list[str]) -> dict[str, str]:
    """All headers for one delivery."""
    return {
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
        "X-Matrix-Event-Id": event_id,
        "X-Matrix-Event-Type": event_type,
        "X-Matrix-Timestamp": str(timestamp),
        "X-Matrix-Signature": signature_header(secrets, timestamp, body),
    }


def verify(*, header: str, secret: str, timestamp: str, body: bytes, now: int, tolerance: int = TOLERANCE_SECS) -> bool:
    """Reference receiver check: fresh timestamp and any matching ``v1`` entry."""
    try:
        ts = int(timestamp)
    except (TypeError, ValueError):
        return False
    if abs(now - ts) > tolerance:
        return False
    expected = sign(secret, ts, body)
    candidates = [part.strip()[3:] for part in header.split(",") if part.strip().startswith("v1=")]
    return any(hmac.compare_digest(expected, c) for c in candidates)
