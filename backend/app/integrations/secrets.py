"""Encrypt and decrypt webhook signing secrets at rest.

The plaintext secret exists only in memory: when it is generated (and shown to
the business admin once) and when the sender signs a request. The database
column ``integration_endpoints.secret_ciphertext`` only ever holds Fernet
ciphertext produced here.

``INTEGRATION_SECRET_KEY`` is a comma list, newest first: ``key2:<k>,key1:<k>``.
New secrets are encrypted with the first key; decryption picks the key by the
stored ``secret_key_version``, so old rows keep working after a key rotation.
"""
from __future__ import annotations

import secrets as _stdlib_secrets

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

SECRET_PREFIX = "whsec_"


class IntegrationKeyError(RuntimeError):
    """The encryption key is missing, malformed, or doesn't match a stored secret."""


def _parse_keys(raw: str) -> list[tuple[int, Fernet]]:
    keys: list[tuple[int, Fernet]] = []
    for part in (p.strip() for p in raw.split(",")):
        if not part:
            continue
        label, sep, key = part.partition(":")
        if not sep:
            label, key = "key1", part
        if not label.startswith("key") or not label[3:].isdigit():
            raise IntegrationKeyError("INTEGRATION_SECRET_KEY entries must look like keyN:<fernet key>")
        try:
            keys.append((int(label[3:]), Fernet(key.encode())))
        except (ValueError, TypeError) as exc:
            raise IntegrationKeyError("INTEGRATION_SECRET_KEY holds an invalid Fernet key") from exc
    return keys


def is_configured() -> bool:
    """True when at least one valid encryption key is set."""
    try:
        return bool(_parse_keys(settings.integration_secret_key))
    except IntegrationKeyError:
        return False


def generate_secret() -> str:
    """A new random signing secret (shown to the admin once, then only stored encrypted)."""
    return SECRET_PREFIX + _stdlib_secrets.token_urlsafe(32)


def encrypt(plain: str) -> tuple[str, int]:
    """Encrypt with the newest key. Returns ``(ciphertext, key_version)``."""
    keys = _parse_keys(settings.integration_secret_key)
    if not keys:
        raise IntegrationKeyError("INTEGRATION_SECRET_KEY is not set")
    version, fernet = keys[0]
    return fernet.encrypt(plain.encode()).decode(), version


def decrypt(ciphertext: str, key_version: int) -> str:
    """Decrypt a stored secret with the key matching ``key_version``."""
    for version, fernet in _parse_keys(settings.integration_secret_key):
        if version == key_version:
            try:
                return fernet.decrypt(ciphertext.encode()).decode()
            except InvalidToken as exc:
                raise IntegrationKeyError(f"secret does not decrypt with key{key_version}") from exc
    raise IntegrationKeyError(f"no key{key_version} in INTEGRATION_SECRET_KEY")
