"""Password hashing for the branded login flow.

Sign-in is (workspace_code + email + password). Passwords are optional at the
database level — legacy users carry `password_hash = NULL` and keep logging in
passwordlessly until they set one — but once set, a password is required.

Uses the `bcrypt` library directly (passlib is unmaintained and breaks against
bcrypt 4.x). bcrypt only considers the first 72 bytes of the input, so we
truncate to 72 bytes up front to avoid bcrypt 4.x's hard ValueError on longer
inputs. Truncation is applied identically on hash and verify, so it is
consistent.
"""
from __future__ import annotations

import bcrypt

_MAX_BYTES = 72


def _prepare(raw: str) -> bytes:
    return (raw or "").encode("utf-8")[:_MAX_BYTES]


def hash_password(raw: str) -> str:
    """Return a bcrypt hash for a plaintext password."""
    return bcrypt.hashpw(_prepare(raw), bcrypt.gensalt()).decode("ascii")


def verify_password(raw: str, hashed: str | None) -> bool:
    """True iff `raw` matches `hashed`. False for a missing/blank/invalid hash."""
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(_prepare(raw), hashed.encode("ascii"))
    except Exception:
        # Malformed hash or backend error — fail closed.
        return False
