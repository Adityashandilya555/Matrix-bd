"""Regression tests for the PR #447 review remediation (rent-type v2 split)."""
from types import SimpleNamespace

from app.domain.schemas.site import StaggeredEscalationItem
from app.services.bd_service import _prepare_staggered_escalation, _apply_split_fields
from app.services import audit_service


def test_legacy_staggered_item_has_no_null_split_keys():
    # #1: model_dump(exclude_none=True) — a legacy {year, percent} item must NOT
    # gain mg/dine_in_pct/delivery_pct null keys (fires even with the flag OFF).
    out = _prepare_staggered_escalation([StaggeredEscalationItem(year=1, percent=5)], "staggered")
    assert out is not None
    assert set(out[0].keys()) == {"year", "percent"}


def test_staggered_item_keeps_filled_split_keys_only():
    out = _prepare_staggered_escalation(
        [StaggeredEscalationItem(year=1, percent=5, dine_in_pct=10)], "staggered"
    )
    assert out[0]["dine_in_pct"] == 10
    assert "delivery_pct" not in out[0]  # unset optional stays absent


def test_apply_split_fields_clears_on_presence_and_ignores_absence():
    # #3: presence in the payload (even None) clears; absence leaves untouched.
    site = SimpleNamespace(revshare_dinein_pct=8, revshare_delivery_pct=5)
    _apply_split_fields(site, {"revshare_dinein_pct": None})
    assert site.revshare_dinein_pct is None
    assert site.revshare_delivery_pct == 5


def test_apply_split_fields_sets_numeric_value():
    site = SimpleNamespace(revshare_dinein_pct=None, revshare_delivery_pct=None)
    _apply_split_fields(site, {"revshare_dinein_pct": "9", "revshare_delivery_pct": 4})
    assert site.revshare_dinein_pct == 9
    assert site.revshare_delivery_pct == 4


def test_split_columns_are_audit_tracked():
    # #10: both columns must be in the differ's field list AND its label map.
    for col in ("revshare_dinein_pct", "revshare_delivery_pct"):
        assert col in audit_service.PIPELINE_FIELDS
        assert col in audit_service._FIELD_AUDIT_LABEL


# ── D4: launch-approval loop ─────────────────────────────────────────────────

def test_launch_rent_fields_request_accepts_split():
    from app.domain.schemas.launch import LaunchRentFieldsRequest
    req = LaunchRentFieldsRequest(revshare_dinein_pct=8, revshare_delivery_pct=5)
    assert req.revshare_dinein_pct == 8
    assert req.revshare_delivery_pct == 5


def test_launch_split_is_editable_and_labeled():
    from app.domain.schemas.launch import RENT_EDITABLE_FIELDS, RENT_FIELD_LABELS
    for col in ("revshare_dinein_pct", "revshare_delivery_pct"):
        assert col in RENT_EDITABLE_FIELDS
        assert col in RENT_FIELD_LABELS


def test_apply_rent_edits_applies_split_and_diffs():
    from app.domain.schemas.launch import LaunchRentFieldsRequest
    from app.services.launch_service import _apply_rent_edits
    row = SimpleNamespace(revshare_dinein_pct=None, revshare_delivery_pct=None)
    changes = _apply_rent_edits(row, LaunchRentFieldsRequest(revshare_dinein_pct=8))
    assert row.revshare_dinein_pct == 8
    assert any(c["field"] == "revshare_dinein_pct" for c in changes)
    # A field not sent is left untouched (exclude_unset).
    assert row.revshare_delivery_pct is None
