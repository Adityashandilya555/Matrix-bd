"""'na' (not applicable) is a resolved licensing state.

These lock the derivation in app.services.licensing_status so an N/A license
behaves like a 'yes' for completion/launch and reads as "done" in the NSO
Stage-2 progress — never leaving a site stuck because a license didn't apply.
"""
from types import SimpleNamespace

from app.services.licensing_status import (
    LEGAL_LICENSE_FIELDS,
    legacy_done,
    legal_license_values,
    legal_licensing_complete,
    stage_two_canonical_status,
)


def _licensing(**overrides):
    values = dict.fromkeys(LEGAL_LICENSE_FIELDS, "yes")
    values.update(overrides)
    return SimpleNamespace(**values)


def test_legacy_done_treats_na_as_done():
    assert legacy_done("yes") == "done"
    assert legacy_done("na") == "done"
    assert legacy_done("no") == "pending"
    assert legacy_done("pending") == "pending"


def test_legal_license_values_passes_na_through():
    lic = _licensing(storage_license="na", fire_noc="no")
    values = legal_license_values(lic)
    assert values["storage_license"] == "na"
    assert values["fire_noc"] == "no"


def test_complete_when_all_yes_or_na():
    site = SimpleNamespace(licensing_status="complete")
    lic = _licensing(fssai="na", storage_license="na")  # rest 'yes'
    assert legal_licensing_complete(site, lic) is True


def test_not_complete_when_any_no():
    site = SimpleNamespace(licensing_status="complete")
    lic = _licensing(fssai="na", health_trade="no")
    assert legal_licensing_complete(site, lic) is False


def test_not_complete_when_rollup_not_complete():
    site = SimpleNamespace(licensing_status="partial")
    lic = _licensing()  # all 'yes'
    assert legal_licensing_complete(site, lic) is False


def test_stage_two_canonical_maps_na_to_done():
    lic = _licensing(fssai="na", fire_noc="no", storage_license="pending")
    canonical = stage_two_canonical_status(lic)
    assert canonical["fssai_status"] == "done"          # na -> done
    assert canonical["fire_noc_status"] == "pending"    # no -> pending
    assert canonical["storage_license_status"] == "pending"
    assert canonical["health_trade_status"] == "done"   # yes -> done
