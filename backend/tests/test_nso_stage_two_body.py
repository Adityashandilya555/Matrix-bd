"""#229 — svc_save_stage_two must not silently drop its request body.

NSO Stage 2 is **auto-derived** from canonical Legal Licensing (``_sync_rollups``);
the five status fields on ``NsoStageTwoRequest`` are advisory and intentionally
not persisted on this endpoint. The bug was that the body was accepted, given a
typed contract, and then *silently ignored* — a user checking boxes got a 200
and believed their input saved.

The fix (Option A — make the contract honest) keeps the auto-derive behaviour but
(1) accepts the body optionally, (2) documents the intent, and (3) logs a WARNING
when a caller submits non-default values that diverge from the derived state, so
the drop is observable instead of silent.

These tests drive the service with the module's data-access helpers monkeypatched,
so they assert the #229 behaviour without depending on the exact SQL shape.
"""
from __future__ import annotations

import logging
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.domain.schemas.nso import NsoStageTwoRequest
from app.services import nso_service

_STAGE_TWO_FIELDS = (
    "fssai_status",
    "health_trade_status",
    "shops_estab_status",
    "fire_noc_status",
    "storage_license_status",
)


def _patch_stage_two(monkeypatch, *, row):
    """Neutralise every data-access dependency so only #229's logic is exercised.

    ``row`` is the canonical NsoReview stand-in returned by ``_fetch_nso_or_create``;
    ``_sync_rollups`` is a no-op so the row keeps the canonical values the test set.
    """
    site = SimpleNamespace(id=uuid4(), tenant_id=uuid4())

    async def _site(*a, **k):
        return site

    async def _none(*a, **k):
        return None

    async def _row(*a, **k):
        return row

    async def _audit(*a, **k):
        return None

    async def _state(*a, **k):
        return SimpleNamespace(site_id=site.id)

    monkeypatch.setattr(nso_service, "fetch_site_or_404", _site)
    monkeypatch.setattr(nso_service, "_fetch_project", _none)
    monkeypatch.setattr(nso_service, "_fetch_licensing", _none)
    monkeypatch.setattr(nso_service, "_fetch_nso_or_create", _row)
    monkeypatch.setattr(nso_service, "_stage_two_unlocked", lambda *a, **k: True)
    monkeypatch.setattr(nso_service, "_sync_rollups", lambda *a, **k: None)
    monkeypatch.setattr(nso_service, "write_audit_event", _audit)
    monkeypatch.setattr(nso_service, "_state_response", _state)
    return site


def _canonical_row():
    return SimpleNamespace(**{f: "pending" for f in _STAGE_TWO_FIELDS})


@pytest.mark.asyncio
async def test_divergent_body_is_logged_not_silently_dropped(monkeypatch, session, caplog):
    """PROVE-FIRST: a submitted value that diverges from canonical state warns.

    Fails on the pre-fix code (the body was never read, so nothing was logged).
    """
    row = _canonical_row()
    _patch_stage_two(monkeypatch, row=row)
    body = NsoStageTwoRequest(fssai_status="done")  # diverges from canonical "pending"

    with caplog.at_level(logging.WARNING, logger="app.services.nso_service"):
        await nso_service.svc_save_stage_two(
            session, tenant_id=uuid4(), actor={"sub": str(uuid4()), "name": "QA"},
            site_id=uuid4(), body=body,
        )

    assert "fssai_status" in caplog.text
    assert "ignoring" in caplog.text.lower()


@pytest.mark.asyncio
async def test_body_fields_are_not_persisted(monkeypatch, session):
    """Option-A contract: Stage 2 reflects canonical licensing; body is not written."""
    row = _canonical_row()
    _patch_stage_two(monkeypatch, row=row)
    body = NsoStageTwoRequest(fssai_status="done", health_trade_status="done")

    await nso_service.svc_save_stage_two(
        session, tenant_id=uuid4(), actor={"sub": str(uuid4()), "name": "QA"},
        site_id=uuid4(), body=body,
    )

    # The canonical row is untouched by the submitted body.
    for field in _STAGE_TWO_FIELDS:
        assert getattr(row, field) == "pending"


@pytest.mark.asyncio
async def test_matching_body_does_not_warn(monkeypatch, session, caplog):
    """No noise when the submitted values already match the canonical state."""
    row = _canonical_row()
    _patch_stage_two(monkeypatch, row=row)
    body = NsoStageTwoRequest()  # all defaults == "pending" == canonical

    with caplog.at_level(logging.WARNING, logger="app.services.nso_service"):
        await nso_service.svc_save_stage_two(
            session, tenant_id=uuid4(), actor={"sub": str(uuid4()), "name": "QA"},
            site_id=uuid4(), body=body,
        )

    assert "ignoring" not in caplog.text.lower()


@pytest.mark.asyncio
async def test_body_is_optional(monkeypatch, session):
    """The endpoint must work when no body is supplied (signature is Optional)."""
    row = _canonical_row()
    _patch_stage_two(monkeypatch, row=row)
    # Must not raise; body defaults to None.
    await nso_service.svc_save_stage_two(
        session, tenant_id=uuid4(), actor={"sub": str(uuid4()), "name": "QA"},
        site_id=uuid4(),
    )
