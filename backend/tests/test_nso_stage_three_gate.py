"""NSO stage three must not open until the project supervisor pushes the
completed project in from the NSO-Handover tab.

Before this gate, a project that became 'done' (now via the PE supervisor's
'Completed') plus complete legal licensing would auto-open NSO stage three even
though nobody had pushed it. These lock the invariant: no push → no stage three.
"""
from __future__ import annotations

import datetime as _dt
import uuid

from app.db import models
from app.services import nso_service


def _site():
    return models.Site(
        id=uuid.uuid4(), tenant_id=uuid.uuid4(), status="in_nso",
        name="poker", city="Bengaluru", submitted_by=uuid.uuid4(),
        licensing_status="complete",
    )


def _licensing(site):
    return models.SiteLicensing(
        site_id=site.id, stage="complete",
        fssai="yes", health_trade="yes", shops_estab_reg="yes",
        fire_noc="yes", storage_license="yes",
    )


def _project_done(site):
    return models.ProjectReview(
        tenant_id=site.tenant_id, site_id=site.id,
        project_status="done", current_stage="done",
        project_completed_at=_dt.datetime(2026, 6, 15, 0, 0, 0),
    )


def _nso(site, **kw):
    base = dict(site_id=site.id, tenant_id=site.tenant_id, communication_floated=True)
    base.update(kw)
    return models.NsoReview(**base)


def test_stage_three_locked_until_pushed_even_when_project_done():
    """Project done + legal complete + stage one done, but NOT pushed → stage two."""
    site = _site()
    licensing = _licensing(site)
    project = _project_done(site)
    row = _nso(site, handover_pushed_at=None)

    assert nso_service._stage_three_unlocked(row, site, licensing, project) is False
    assert nso_service._compute_stage(site, row, project, licensing) == "stage_two"


def test_stage_three_opens_once_pushed():
    """The project supervisor's push (handover_pushed_at) opens stage three."""
    site = _site()
    licensing = _licensing(site)
    project = _project_done(site)
    row = _nso(site, handover_pushed_at=_dt.datetime(2026, 6, 15, 1, 0, 0))

    assert nso_service._stage_three_unlocked(row, site, licensing, project) is True
    # Stage-three work isn't filled yet, so the stage is 'stage_three' (not 'final').
    assert nso_service._compute_stage(site, row, project, licensing) == "stage_three"
