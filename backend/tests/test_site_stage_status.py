"""BD process-flow stage-status projection (read-only visibility surface).

Covers the aggregation service that powers the "View status" popup and the
clickable pipeline nodes: it must fold the downstream module tables
(design_deliverables, project_reviews, nso_reviews) into labelled sub-status
rows and surface a stage-events timeline — without ever exposing an action.
"""
from __future__ import annotations

import asyncio
import types
import uuid
from datetime import datetime, timezone

from app.services.site_stage_status_service import build_stage_status_response


def _site(**over):
    base = dict(
        id=uuid.uuid4(), tenant_id=uuid.uuid4(), submitted_by=uuid.uuid4(),
        assigned_to=None, code="BT-NEW-8LTA", name="demo 8", city="New Delhi",
        status="legal_review", legal_dd_status="positive", agreement_status="signed",
        licensing_status="partial", design_status="approved", finance_status="approved",
        kyc_verified=True, ca_code="BT-DEL-0042", finance_amount=50000,
        is_launched=False, launched_at=None,
    )
    base.update(over)
    return types.SimpleNamespace(**base)


def _run(session, site, *, actor_role="supervisor"):
    current_user = {"sub": str(site.submitted_by), "role": actor_role, "module": "bd"}
    return asyncio.run(build_stage_status_response(
        session, site_id=site.id, tenant_id=site.tenant_id, current_user=current_user,
    ))


def _deliverable(kind, status):
    return types.SimpleNamespace(kind=kind, status=status)


def test_stage_status_folds_design_and_project_substatus(make_session, fake_result):
    site = _site()
    project = types.SimpleNamespace(
        project_status="in_progress", current_stage="execution",
        initialization_status="approved", expected_completion_status="submitted",
        quality_audit_status="pending", nso_status="pending",
    )
    deliverables = [
        _deliverable("recce", "approved"),
        _deliverable("2d", "approved"),
        _deliverable("3d", "submitted"),
    ]
    design_review = types.SimpleNamespace(current_stage="3d", gfc_status="pending")

    # Execute order mirrors the service: site, project, nso, launch,
    # deliverables, design_review, dd, excellence, stage_events. No user lookup.
    session = make_session(
        fake_result(scalar=site),                    # fetch_site_or_404
        fake_result(scalar=project),                 # ProjectReview
        fake_result(scalar=None),                    # NsoReview
        fake_result(scalar=None),                    # LaunchApproval
        fake_result(scalars_list=deliverables),      # DesignDeliverable
        fake_result(scalar=design_review),           # DesignReview
        fake_result(scalar=None),                    # LegalDdChecklist
        fake_result(scalar=None),                    # SiteBudget (gfc)
        fake_result(scalars_list=[]),                # StageEvent
    )
    resp = _run(session, site)

    stages = {s.id: s for s in resp.stages}
    assert set(stages) == {"loi", "legal", "ca", "design", "excellence", "project", "nso", "launch"}
    assert resp.legal_has_negative is False

    design = stages["design"]
    labels = {r.label: r.value for r in design.rows}
    assert labels["Recce"] == "Approved"
    assert labels["3D drawings"] == "Submitted"
    assert labels["BOQ"] == "Pending"          # missing deliverable defaults to pending
    assert design.note == "Active stage: 3D"

    project_rows = {r.label: r.value for r in stages["project"].rows}
    assert project_rows["Quality audit"] == "Pending"
    assert project_rows["Initialization"] == "Approved"

    ca_rows = {r.label: r.value for r in stages["ca"].rows}
    assert ca_rows["CA / commercial code"] == "BT-DEL-0042"

    # Design approved => headline points at Project Execution.
    assert "Project Execution" in resp.headline


def test_stage_status_flags_negative_dd(make_session, fake_result):
    site = _site(status="legal_review", legal_dd_status="in_review", design_status="pending")
    dd = types.SimpleNamespace(
        final_verdict="pending",
        title_doc="yes", sanctioned_plan="yes", oc_cc="no", commercial_use="pending",
        property_tax="pending", electricity="pending", fire_noc="no",
        other_1="pending", other_2="pending", other_1_label=None, other_2_label=None,
    )
    session = make_session(
        fake_result(scalar=site),               # fetch_site_or_404
        fake_result(scalar=None),               # ProjectReview
        fake_result(scalar=None),               # NsoReview
        fake_result(scalar=None),               # LaunchApproval
        fake_result(scalars_list=[]),           # DesignDeliverable
        fake_result(scalar=None),               # DesignReview
        fake_result(scalar=dd),                 # LegalDdChecklist
        fake_result(scalar=None),               # SiteBudget (gfc)
        fake_result(scalars_list=[]),           # StageEvent
    )
    resp = _run(session, site)
    assert resp.legal_has_negative is True
    legal = next((s for s in resp.stages if s.id == "legal"), None)
    assert legal is not None
    negatives = [r.label for r in legal.rows if r.value == "No"]
    assert "OC / CC" in negatives and "Fire NOC" in negatives


def test_stage_status_timeline_maps_events(make_session, fake_result):
    site = _site(status="loi_uploaded", design_status="pending", legal_dd_status="pending")
    actor_id = uuid.uuid4()
    event = types.SimpleNamespace(
        event_type="legal_review_started", from_status="loi_uploaded",
        to_status="legal_review", actor_role="executive", actor_id=actor_id,
        occurred_at=datetime(2026, 7, 14, tzinfo=timezone.utc),
    )
    session = make_session(
        fake_result(scalar=site),               # fetch_site_or_404
        fake_result(scalar=None),               # ProjectReview
        fake_result(scalar=None),               # NsoReview
        fake_result(scalar=None),               # LaunchApproval
        fake_result(scalars_list=[]),           # DesignDeliverable
        fake_result(scalar=None),               # DesignReview
        fake_result(scalar=None),               # LegalDdChecklist
        fake_result(scalar=None),               # SiteBudget (gfc)
        fake_result(scalars_list=[event]),      # StageEvent
        fake_result(all_rows=[(actor_id, "Asha B.")]),  # fetch_user_names
    )
    resp = _run(session, site)
    assert len(resp.timeline) == 1
    entry = resp.timeline[0]
    assert entry.event_type == "legal_review_started"
    assert entry.actor_name == "Asha B."
    assert entry.to_status == "legal_review"
