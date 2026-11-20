"""NSO webhook integration: pure units (no database). Runs in CI."""
from __future__ import annotations

import ast
import re
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet

from app.core.config import settings
from app.integrations import nso_payload as nso
from app.integrations import secrets as secret_store
from app.integrations import sender, signing

APP_DIR = Path(__file__).parents[1] / "app"


# ── Signing ──────────────────────────────────────────────────────────────

def test_signature_round_trip_and_tamper():
    body = signing.canonical_body({"b": 1, "a": "é"})
    assert body == '{"a":"é","b":1}'.encode()
    header = signing.signature_header(["whsec_new", "whsec_old"], 1_700_000_000, body)
    assert header.count("v1=") == 2
    for secret in ("whsec_new", "whsec_old"):
        assert signing.verify(header=header, secret=secret, timestamp="1700000000", body=body, now=1_700_000_100)
    assert not signing.verify(header=header, secret="wrong", timestamp="1700000000", body=body, now=1_700_000_100)
    assert not signing.verify(header=header, secret="whsec_new", timestamp="1700000000", body=body + b" ", now=1_700_000_100)


def test_signature_rejects_stale_or_bad_timestamp():
    body = b"{}"
    header = signing.signature_header(["s"], 1000, body)
    assert not signing.verify(header=header, secret="s", timestamp="1000", body=body, now=1000 + 301)
    assert not signing.verify(header=header, secret="s", timestamp="soon", body=body, now=1000)


def test_headers_carry_event_metadata():
    h = signing.build_headers(event_id="e1", event_type="site.updated", timestamp=5, body=b"{}", secrets=["s"])
    assert h["X-Matrix-Event-Id"] == "e1"
    assert h["X-Matrix-Timestamp"] == "5"
    assert h["X-Matrix-Signature"].startswith("v1=")


# ── Secrets ──────────────────────────────────────────────────────────────

def test_secret_encrypt_decrypt_and_key_rotation(monkeypatch):
    k1, k2 = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    monkeypatch.setattr(settings, "integration_secret_key", f"key1:{k1}")
    plain = secret_store.generate_secret()
    assert plain.startswith("whsec_")
    ct, v = secret_store.encrypt(plain)
    assert v == 1 and plain not in ct
    monkeypatch.setattr(settings, "integration_secret_key", f"key2:{k2},key1:{k1}")
    assert secret_store.decrypt(ct, 1) == plain           # old rows still decrypt
    assert secret_store.encrypt(plain)[1] == 2            # new rows use the newest key


def test_secret_store_unconfigured_or_bad(monkeypatch):
    monkeypatch.setattr(settings, "integration_secret_key", "")
    assert not secret_store.is_configured()
    with pytest.raises(secret_store.IntegrationKeyError):
        secret_store.encrypt("x")
    monkeypatch.setattr(settings, "integration_secret_key", "key1:not-a-fernet-key")
    assert not secret_store.is_configured()


# ── Payload ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize(("raw", "expected"), [
    ("12.9716, 77.6412", (12.9716, 77.6412)),
    ("-33.86,151.2", (-33.86, 151.2)),
    ("near the metro", (None, None)),
    ("95, 10", (None, None)),
    (None, (None, None)),
])
def test_parse_pin(raw, expected):
    assert nso.parse_pin(raw) == expected


def test_eligibility_rule():
    assert nso.is_eligible("EX-1")
    assert not nso.is_eligible(None)
    assert not nso.is_eligible("")


def test_snapshot_reads_only_watched_columns():
    """Every column the snapshot reads must be in WATCHED, so a change to it queues an event."""
    src = (APP_DIR / "integrations" / "nso_payload.py").read_text()
    body = src[src.index("def build_snapshot"):src.index("def tombstone")]
    watched_names = {name for attrs in nso.WATCHED.values() for name in attrs}
    read = set(re.findall(r"\bs\.(\w+)", body)) | set(re.findall(r"\bpr\.(\w+)", body))
    read |= set(re.findall(r"models\.(?:SiteLicensing|NsoReview)\.(\w+)", body))
    read -= {"id", "tenant_id", "site_id", "where"}
    assert read <= watched_names, read - watched_names


def test_payload_never_names_forbidden_fields():
    src = (APP_DIR / "integrations" / "nso_payload.py").read_text()
    code = "\n".join(line for line in src.splitlines() if not line.lstrip().startswith("#"))
    code = code.split('"""', 2)[2]  # drop the module docstring, which names them as warnings
    for forbidden in ("workspace_code", "spoc_email", "phone", "rent", "deposit"):
        assert forbidden not in code, forbidden


def test_event_types_match_db_check():
    for event_type in (nso.EVENT_UPDATED, nso.EVENT_DELETED, nso.EVENT_TEST):
        assert re.fullmatch(r"site\.[a-z_]+", event_type)


# ── Capture coverage guard ───────────────────────────────────────────────

def test_no_bulk_update_or_raw_sql_bypasses_the_hook():
    """The capture hook only sees ORM unit-of-work changes. A bulk update() or a
    raw UPDATE on a watched table would silently skip the NSO integration."""
    tables = ("sites", "site_licensing", "project_reviews", "nso_reviews")
    models_ = ("Site", "SiteLicensing", "ProjectReview", "NsoReview")
    offenders = []
    for path in APP_DIR.rglob("*.py"):
        src = path.read_text()
        for m in models_:
            if re.search(rf"\bupdate\(\s*(?:models\.)?{m}\b", src):
                offenders.append(f"{path.name}: update(models.{m})")
        for t in tables:
            if re.search(rf"UPDATE\s+(?:public\.)?{t}\b", src, re.I):
                offenders.append(f"{path.name}: UPDATE {t}")
    assert offenders == []


# ── Sender helpers ───────────────────────────────────────────────────────

@pytest.mark.parametrize(("http_status", "attempts", "expected"), [
    (200, 1, "sent"), (204, 3, "sent"),
    (500, 1, "failed"), (503, 11, "failed"), (500, 12, "dead"),
    (None, 1, "failed"), (408, 1, "failed"), (429, 1, "failed"),
    (400, 1, "dead"), (401, 1, "dead"), (404, 1, "dead"), (410, 1, "dead"),
])
def test_classify(http_status, attempts, expected):
    assert sender.classify(http_status, attempts) == expected


def test_backoff_grows_and_honours_retry_after():
    first, later = sender.backoff(1), sender.backoff(5)
    assert timedelta(seconds=27) <= first <= timedelta(seconds=33)
    assert later > first
    assert sender.backoff(1, retry_after=600) >= timedelta(seconds=600)
    assert sender.backoff(1, retry_after=10**9) <= timedelta(hours=12)
    assert sender.parse_retry_after("120") == 120
    assert sender.parse_retry_after("Wed, 21 Oct 2026 07:28:00 GMT") is None


@pytest.mark.parametrize(("addr", "blocked"), [
    ("10.0.0.5", True), ("127.0.0.1", True), ("169.254.169.254", True), ("192.168.1.1", True),
    ("::1", True), ("fd00::1", True), ("0.0.0.0", True), ("8.8.8.8", False), ("2606:4700::1111", False),
    ("100.64.0.1", True), ("100.127.255.254", True), ("198.18.0.1", True), ("192.0.0.8", True),
    ("::ffff:127.0.0.1", True), ("::ffff:100.64.0.1", True), ("224.0.0.1", True),
])
def test_ssrf_guard(addr, blocked):
    assert sender.is_blocked_ip(addr) is blocked


async def test_assert_public_host_rejects_localhost():
    with pytest.raises(sender.BlockedAddressError):
        await sender.assert_public_host("https://localhost/hook")
    with pytest.raises(sender.BlockedAddressError):
        await sender.assert_public_host("https:///nohost")


def test_envelope_puts_metadata_first_and_keeps_payload():
    from datetime import datetime, timezone
    row = SimpleNamespace(
        id="e1", event_type="site.updated", schema_version="1", seq=7,
        created_at=datetime(2026, 11, 20, 9, 0, tzinfo=timezone.utc), payload={"site": {"id": "s1"}},
    )
    env = sender.envelope(row)
    assert env["occurred_at"] == "2026-11-20T09:00:00Z"
    assert env["seq"] == 7 and env["site"] == {"id": "s1"}


# ── Router ───────────────────────────────────────────────────────────────

def test_every_integration_route_requires_real_business_admin():
    src = (APP_DIR / "routers" / "integrations.py").read_text()
    tree = ast.parse(src)
    routes = [n for n in tree.body if isinstance(n, ast.AsyncFunctionDef)]
    assert routes
    for fn in routes:
        annotations = {ast.unparse(a.annotation) for a in fn.args.args if a.annotation}
        assert "AdminUser" in annotations, fn.name
    assert "require_real_role(Role.BUSINESS_ADMIN)" in src


def test_pinned_request_keeps_host_and_sni():
    assert sender.pinned_request("https://nso.example.com/hook?x=1", "93.184.216.34") == (
        "https://93.184.216.34/hook?x=1", "nso.example.com", "nso.example.com")
    assert sender.pinned_request("https://nso.example.com:8443/h", "2606:4700::1111") == (
        "https://[2606:4700::1111]:8443/h", "nso.example.com:8443", "nso.example.com")
