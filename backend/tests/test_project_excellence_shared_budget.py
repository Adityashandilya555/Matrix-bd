"""Regression: Project Excellence runs on the SHARED site_budgets (gfc phase),
unlocks at Design GFC approval (not project completion), and Design ends at GFC
(BOQ removed from the flow). Locks the 2026-06-14 repositioning so it can't
silently revert to the merged PE-private / post-project-done design.
"""
from __future__ import annotations

import inspect

from app.db import models
from app.services import budget_service


def test_shared_budget_models_replace_pe_private():
    assert hasattr(models, "SiteBudget")
    assert hasattr(models, "SiteBudgetItem")
    # The PE-private models are gone (replaced by the shared, phased budget).
    assert not hasattr(models, "ProjectExcellenceReview")
    assert not hasattr(models, "ProjectExcellenceItem")
    cols = models.SiteBudget.__table__.columns
    assert "phase" in cols and "status" in cols
    uqs = {
        c.name for c in models.SiteBudget.__table__.constraints
        if c.__class__.__name__ == "UniqueConstraint"
    }
    assert "uq_site_budget_site_phase" in uqs  # one budget per (site, phase)


def test_pe_unlocks_on_design_gfc_not_project_done():
    import app.services.project_excellence_service as pe
    src = inspect.getsource(pe)
    assert "design_status" in src
    assert 'project_status == "done"' not in src          # old gate is gone
    assert "budget_service" in src                          # uses the shared budget
    assert "ProjectExcellenceReview" not in src
    assert "ProjectExcellenceItem" not in src
    assert "_PHASE = budget_service.GFC" in src             # writes only the gfc phase
    assert 'models.Site.design_status == "approved"' in src  # queue filter


def test_design_gfc_completes_and_opens_gfc_budget():
    import app.services.design_service as ds
    src = inspect.getsource(ds)
    assert 'site.design_status = "approved"' in src
    assert "budget_service.fetch_or_create_budget" in src
    assert "phase=budget_service.GFC" in src
    # BOQ removed from the deliverable flow (it stays valid in the DB for history).
    assert ds._NEEDS_ADMIN == frozenset({"2d", "3d"})
    assert "boq" not in ds._NEXT_STAGE
    assert "boq" not in ds._DELIVERABLE_KINDS


def test_budget_labels_are_the_eleven():
    assert len(budget_service.BUDGET_LABELS) == 11
    assert budget_service.BUDGET_LABELS[0] == "Professional Fees"
    assert budget_service.BUDGET_LABELS[-1] == "Misc"
    assert budget_service.GFC == "gfc" and budget_service.CLOSURE == "closure"
