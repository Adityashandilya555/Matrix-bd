"""#229 — svc_save_stage_two must not silently drop its request body.

NSO Stage 2 is **auto-derived** from canonical Legal Licensing (`_state_response`
surfaces `_legacy_done(licensing.<field>)`); the five status fields on
`NsoStageTwoRequest` are advisory and intentionally not persisted on this
endpoint. The bug was that the body was accepted, given a typed contract, and
then *silently ignored* — a user checking boxes got a 200 and believed their
input saved.

The fix (Option A — make the contract honest) keeps the auto-derive behaviour but
(1) accepts the body optionally, (2) documents the intent, and (3) logs a WARNING
when a submitted value **diverges from the Legal Licensing-derived canonical
state**, so the drop is observable instead of silent.

PR-review follow-up (#248): the divergence check must compare against the
licensing-derived canonical (the same values clients see), NOT the never-synced
`NsoReview.*_status` columns — otherwise it false-warns on every normal save.
`test_stale_row_matching_canonical_does_not_warn` locks that.
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


def _patch_stage_two(monkeypatch, *, row, canonical=None):
    """Neutralise data-access deps so only #229's divergence logic is exercised.

    ``row`` is the NsoReview stand-in from ``_fetch_nso_or_create``; ``canonical``
    is the Legal Licensing-derived status map the check compares against (defaults
    to all-"pending"). ``_sync_rollups`` is a no-op so ``row`` keeps its values.
    """
    site = SimpleNamespace(id=uuid4(), tenant_id=uuid4())
    canonical = canonical or {f: "pending" for f in _STAGE_TWO_FIELDS}

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
    monkeypatch.setattr(nso_service, "_stage_two_canonical_status", lambda site, licensing: dict(canonical))
    monkeypatch.setattr(nso_service, "write_audit_event", _audit)
    monkeypatch.setattr(nso_service, "_state_response", _state)
    return site


def _canonical_row():
    return SimpleNamespace(**{f: "pending" for f in _STAGE_TWO_FIELDS})


async def _call(session, body):
    return await nso_service.svc_save_stage_two(
        session, tenant_id=uuid4(), actor={"sub": str(uuid4()), "name": "QA"},
        site_id=uuid4(), body=body,
    )


@pytest.mark.asyncio
async def test_divergent_body_is_logged_not_silently_dropped(monkeypatch, session, caplog):
    """PROVE-FIRST: a submitted value that diverges from canonical state warns.

    Fails on the pre-fix code (the body was never read, so nothing was logged).
    """
    _patch_stage_two(monkeypatch, row=_canonical_row())  # canonical all "pending"
    body = NsoStageTwoRequest(fssai_status="done")        # diverges from canonical

    with caplog.at_level(logging.WARNING, logger="app.services.nso_service"):
        await _call(session, body)

    assert "fssai_status" in caplog.text
    assert "ignoring" in caplog.text.lower()


@pytest.mark.asyncio
async def test_stale_row_matching_canonical_does_not_warn(monkeypatch, session, caplog):
    """#248 review: compare against licensing-derived canonical, NOT row.*_status.

    Row is stale ("pending") but canonical (from licensing) is "done", and the
    client submits "done" (matching canonical). The pre-fix code compared to the
    stale row and false-warned; the fix compares to canonical and stays quiet.
    """
    row = _canonical_row()                                 # row.fssai_status == "pending" (stale)
    canonical = {f: "pending" for f in _STAGE_TWO_FIELDS}
    canonical["fssai_status"] = "done"                     # licensing says done
    _patch_stage_two(monkeypatch, row=row, canonical=canonical)
    body = NsoStageTwoRequest(fssai_status="done")         # matches canonical, not row

    with caplog.at_level(logging.WARNING, logger="app.services.nso_service"):
        await _call(session, body)

    assert "ignoring" not in caplog.text.lower()


@pytest.mark.asyncio
async def test_body_fields_are_not_persisted(monkeypatch, session):
    """Option-A contract: Stage 2 reflects canonical licensing; body is not written."""
    row = _canonical_row()
    _patch_stage_two(monkeypatch, row=row)
    await _call(session, NsoStageTwoRequest(fssai_status="done", health_trade_status="done"))

    for field in _STAGE_TWO_FIELDS:
        assert getattr(row, field) == "pending"


@pytest.mark.asyncio
async def test_matching_body_does_not_warn(monkeypatch, session, caplog):
    """No noise when the submitted values already match the canonical state."""
    _patch_stage_two(monkeypatch, row=_canonical_row())
    with caplog.at_level(logging.WARNING, logger="app.services.nso_service"):
        await _call(session, NsoStageTwoRequest())          # all defaults == canonical

    assert "ignoring" not in caplog.text.lower()


@pytest.mark.asyncio
async def test_body_is_optional(monkeypatch, session):
    """The endpoint must work when no body is supplied (signature is Optional)."""
    _patch_stage_two(monkeypatch, row=_canonical_row())
    await nso_service.svc_save_stage_two(
        session, tenant_id=uuid4(), actor={"sub": str(uuid4()), "name": "QA"},
        site_id=uuid4(),
    )


def test_canonical_status_derives_from_licensing_not_row():
    """_stage_two_canonical_status reads Legal Licensing (`yes` → `done`), not row."""
    site = SimpleNamespace(licensing_status="complete")
    licensing = SimpleNamespace(
        stage="published", fssai="yes", health_trade=None,
        shops_estab_reg=None, fire_noc=None, storage_license=None,
    )
    canonical = nso_service._stage_two_canonical_status(site, licensing)
    assert canonical["fssai_status"] == "done"            # licensing 'yes' → done
    assert canonical["health_trade_status"] == "pending"  # absent → pending
