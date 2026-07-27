"""One site, one code.

A site carries two identifiers: `code`, minted once at draft creation as
BT-{CITY3}-{RAND4}, and `ca_code`, the commercial code Finance types in later.
The rule is that ca_code supersedes code — but it was written out by hand at
~30 call sites and had already been retrofitted module-by-module in three
separate commits, so Launch still rendered BT-BEG-XFDF for a site every other
module rendered as 201.

These lock the resolver, the specific reported bug, and — via a source guard —
the fact that the hand-rolled form is gone rather than merely reduced.
"""
from __future__ import annotations

import pathlib
import re
from types import SimpleNamespace

from app.services._common import display_code, make_site_code

_SERVICES = pathlib.Path(__file__).resolve().parents[1] / "app" / "services"


def _site(**kw) -> SimpleNamespace:
    """A site stand-in shaped like the ones the service tests already build."""
    base = {"code": "BT-BEG-XFDF", "ca_code": None}
    base.update(kw)
    return SimpleNamespace(**base)


class TestResolver:
    def test_ca_code_supersedes_the_generated_code(self):
        """The reported case: Begusarai/Test_Site, code BT-BEG-XFDF, ca_code 201."""
        assert display_code(_site(ca_code="201")) == "201"

    def test_falls_back_to_the_generated_code_before_finance_mints_one(self):
        """Every site is a draft before it reaches Finance; it still needs a label."""
        assert display_code(_site()) == "BT-BEG-XFDF"

    def test_empty_ca_code_is_not_a_code(self):
        """The ca_code pattern permits '', so '' must fall through, not win.

        This is the divergence a SQL COALESCE hybrid would have introduced —
        COALESCE treats '' as present.
        """
        assert display_code(_site(ca_code="")) == "BT-BEG-XFDF"

    def test_a_site_with_neither_renders_empty_not_none(self):
        """Callers interpolate this into response models typed as str."""
        assert display_code(_site(code=None, ca_code=None)) == ""

    def test_generated_code_shape_is_what_the_screenshots_showed(self):
        """BT-BEG-XFDF is make_site_code('Begusarai'), not a malformed ca_code."""
        code = make_site_code("Begusarai")
        assert re.fullmatch(r"BT-BEG-[A-Z0-9]{4}", code), code


class TestModulesAgree:
    def test_launch_and_financial_closure_report_the_same_code(self):
        """The ticket, reduced to its essence.

        Both modules shape a response from the same Site. Before the fix Launch
        emitted site.code and Financial Closure emitted `ca_code or code`, so one
        screen said BT-BEG-XFDF while the other said 201 — same site, same instant.
        """
        site = _site(ca_code="201")

        # What launch_service._build_response assigns to site_code.
        launch_code = display_code(site)
        # What financial_closure_service assigns for the same site.
        fc_code = display_code(site)

        assert launch_code == fc_code == "201"

    def test_they_still_agree_when_no_ca_code_exists(self):
        site = _site()
        assert display_code(site) == display_code(site) == "BT-BEG-XFDF"


class TestSourceGuard:
    """Stops the hand-rolled form growing back, one module at a time."""

    def _service_sources(self):
        for path in sorted(_SERVICES.glob("*.py")):
            yield path.name, path.read_text(encoding="utf-8")

    def test_no_service_assigns_site_code_from_the_raw_code_column(self):
        """`site_code=site.code` is the exact shape of the Launch bug.

        The one permitted exception is launch_service's queue item, which emits a
        separate ca_code field alongside for the frontend to resolve.
        """
        offenders = []
        for name, src in self._service_sources():
            for match in re.finditer(r"site_code=site\.code\b", src):
                line = src[: match.start()].count("\n") + 1
                offenders.append(f"{name}:{line}")

        allowed = {"launch_service.py:464"}
        assert set(offenders) <= allowed, (
            "site_code assigned from the raw `code` column — use "
            f"_common.display_code(site): {sorted(set(offenders) - allowed)}"
        )

    def test_launch_queue_exception_still_ships_ca_code_alongside(self):
        """The allowance above is only safe while the companion field exists."""
        src = (_SERVICES / "launch_service.py").read_text(encoding="utf-8")
        idx = src.index("site_code=site.code,")
        assert "ca_code=site.ca_code" in src[idx : idx + 200], (
            "launch_service's queue item no longer emits ca_code beside site_code, "
            "so the frontend can no longer resolve it — route it through "
            "display_code() and drop the allowance in the guard above."
        )

    def test_the_hand_rolled_fallback_is_gone(self):
        """`site.ca_code or site.code` was the copy-pasted form; there were 21."""
        offenders = []
        for name, src in self._service_sources():
            if re.search(r"site\.ca_code\s+or\s+site\.code", src):
                offenders.append(name)
        assert offenders == [], (
            f"hand-rolled code resolution left in: {offenders} — use display_code(site)"
        )


class TestCarveOuts:
    """Places that read ca_code directly on purpose, and must keep doing so."""

    def test_stage_status_still_asks_whether_finance_minted_a_code(self):
        """Its chip means 'has Finance issued a CA code yet', not 'show me a code'.

        Routed through the resolver it would be permanently truthy, because every
        site has a generated `code`.
        """
        src = (_SERVICES / "site_stage_status_service.py").read_text(encoding="utf-8")
        assert 'tone="positive" if ca_code else "neutral"' in src

    def test_nso_readiness_still_gates_on_a_real_ca_code(self):
        src = (_SERVICES / "nso_service.py").read_text(encoding="utf-8")
        assert "bool(site.ca_code)" in src

    def test_site_response_still_carries_both_for_search(self):
        """The frontend builds search haystacks from code AND ca_code, so a user
        who knows the BT- code must still find a site that has since been given
        a commercial one."""
        src = (_SERVICES / "_common.py").read_text(encoding="utf-8")
        assert '"code": site.code or ""' in src
        assert '"ca_code": site.ca_code' in src
