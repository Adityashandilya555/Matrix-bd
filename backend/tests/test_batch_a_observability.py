"""Batch A — backend observability / guards.

Covers GitHub issues:
  #145 launch_service: UUID(actor['sub']) unguarded -> 500   (now clean 401)
  #141 launch_service: svc_create_launch_approval missing flush/isolation
  #146 query_service._row_stage: bare except with no logging
  #144 delegation_service: bare excepts swallow errors with no logging
  #147 tenancy.public_branding: logo signing failure swallowed with no logging

Each test is written to FAIL against the pre-fix code and PASS after the fix.
"""
from __future__ import annotations

import logging
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.routers import tenancy
from app.services import delegation_service, launch_service, query_service


# ── #145 — actor UUID guard ────────────────────────────────────────────────

def test_actor_uuid_valid_returns_uuid():
    u = "12345678-1234-1234-1234-123456789abc"
    assert launch_service._actor_uuid({"sub": u}) == UUID(u)


def test_actor_uuid_missing_sub_raises_401():
    with pytest.raises(HTTPException) as ei:
        launch_service._actor_uuid({})
    assert ei.value.status_code == 401


def test_actor_uuid_malformed_raises_401():
    with pytest.raises(HTTPException) as ei:
        launch_service._actor_uuid({"sub": "not-a-uuid"})
    assert ei.value.status_code == 401


# ── #141 — launch approval create flushes + isolates failures ──────────────

def _fake_site():
    return SimpleNamespace(
        id=uuid4(),
        tenant_id=uuid4(),
        rent_type="fixed",
        expected_rent=100,
        expected_escalation_pct=5,
        expected_escalation_years=3,
        expected_revshare_pct=None,
        revshare_dinein_pct=None,
        revshare_delivery_pct=None,
    )


async def test_create_launch_approval_flushes(session):
    site = _fake_site()
    row = await launch_service.svc_create_launch_approval(
        session, site=site, tenant_id=site.tenant_id,
    )
    # The fix flushes inside a savepoint so a constraint violation surfaces here
    # instead of poisoning the parent NSO transaction. The validation-loop rework
    # (202606121) adds a second flush for the draft `baseline` rent-history event
    # — both live inside the same savepoint.
    assert session.flush_count == 2
    assert row in session.added
    assert any(getattr(o, "action", None) == "baseline" for o in session.added), \
        "svc_create_launch_approval must record a baseline rent event"


async def test_create_launch_approval_on_integrity_returns_existing(make_session, fake_result):
    existing = object()
    # execute() calls: (1) existing-check -> None, (2) site_details -> None,
    # (3) re-fetch after IntegrityError -> the winning row.
    sess = make_session(
        fake_result(scalar=None),
        fake_result(scalar=None),
        fake_result(scalar=existing),
    )

    async def _boom_flush():
        raise IntegrityError("INSERT", {}, Exception("duplicate site_id"))

    sess.flush = _boom_flush
    site = _fake_site()

    row = await launch_service.svc_create_launch_approval(
        sess, site=site, tenant_id=site.tenant_id,
    )
    assert row is existing  # did NOT propagate the IntegrityError as a 500


# ── #146 — query_service._row_stage logs the swallowed error ───────────────

def test_row_stage_logs_and_defaults(caplog):
    class BadRow:
        @property
        def stage(self):  # noqa: D401 - intentional raiser
            raise RuntimeError("boom")

    with caplog.at_level(logging.ERROR):
        out = query_service._row_stage(BadRow())
    assert out == "published"
    assert "_row_stage" in caplog.text


# ── #144 — delegation_service logs the swallowed error ─────────────────────

async def test_svc_is_delegated_logs_and_returns_false(session, caplog):
    async def _boom(*a, **k):
        raise RuntimeError("db down")

    session.execute = _boom
    with caplog.at_level(logging.ERROR):
        out = await delegation_service.svc_is_delegated(
            session, tenant_id="t", site_id="s", user_id="u", module="legal",
        )
    assert out is False
    assert "svc_is_delegated" in caplog.text


async def test_svc_assigned_sites_logs_and_returns_empty(session, caplog):
    async def _boom(*a, **k):
        raise RuntimeError("db down")

    session.execute = _boom
    with caplog.at_level(logging.ERROR):
        out = await delegation_service.svc_assigned_sites(
            session, tenant_id="t", user_id="u", module="legal",
        )
    assert out == []
    assert "svc_assigned_sites" in caplog.text


# ── #147 — tenancy.public_branding logs a signing failure ──────────────────

async def test_public_branding_logs_when_signing_fails(make_session, fake_result, monkeypatch, caplog):
    async def _boom(*a, **k):
        raise RuntimeError("storage down")

    monkeypatch.setattr(tenancy, "signed_url", _boom)
    sess = make_session(
        fake_result(mappings_rows=[{"name": "Acme", "logo_url": "branding/x/logo.png"}]),
    )
    with caplog.at_level(logging.DEBUG):
        out = await tenancy.public_branding(code="ABC", db=sess)
    assert out["name"] == "Acme"
    assert out["logo_url"] is None  # degraded gracefully
    assert "public_branding" in caplog.text
