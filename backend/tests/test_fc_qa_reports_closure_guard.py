"""The Financial Closure qa-reports route is confined to sites in closure.

PR #494 dropped ``require_module("project")`` from three Financial Closure reads
so the closure summary page works for a Launch Sites supervisor, who holds
whichever module they were onboarded into. That was the right call and these
tests do not walk it back: tenant isolation comes from ``fetch_site_or_404`` in
the service layer, not from the module claim, and supervisors were already
unscoped per-site on the other two reads — the claim was barring them for an
unrelated reason.

But two of the three reads are confined to sites actually IN closure — /queue by
``financial_closure_status != 'pending'`` and /{site_id} by
``_assert_closure_open`` — and qa-reports had no such check. The executive branch
is the only per-site narrowing in that handler, so a SUPERVISOR got none at all,
and could mint signed download URLs for the before/after quality-audit PDFs of
any site in the tenant, including sites never sent to closure. Before this route
existed there was no path to those PDFs for a non-project supervisor: the project
and project_excellence routes are module-gated, and admin-detail is
BUSINESS_ADMIN, whose READ_ALL_ROLES bypass covers business_admin and observer
but not supervisor.

Intra-tenant and limited to already-trusted roles, so not outsider-facing — but
strictly broader than the surface the route was added for. These pin the guard,
and just as importantly pin the two places it must NOT be added.
"""
from __future__ import annotations

import inspect
import types
import uuid

import pytest
from fastapi import HTTPException

TENANT = str(uuid.uuid4())
SITE = str(uuid.uuid4())


def _supervisor():
    return {"sub": str(uuid.uuid4()), "role": "supervisor", "name": "Sup"}


def _executive():
    return {"sub": str(uuid.uuid4()), "role": "executive", "name": "Exec"}


def _site(status):
    return types.SimpleNamespace(
        id=uuid.uuid4(), tenant_id=TENANT, financial_closure_status=status,
    )


def _recording_svc(called):
    async def _svc(_db, *, tenant_id, site_id):
        called["svc"] = True
        return "QA_RESPONSE"
    return _svc


async def test_supervisor_refused_for_a_site_never_sent_to_closure(
    make_session, fake_result, monkeypatch,
):
    from app.routers import financial_closure as fc

    called = {"svc": False}
    monkeypatch.setattr(fc, "svc_qa_reports_for_site", _recording_svc(called))
    session = make_session(fake_result(scalar=_site("pending")))

    with pytest.raises(HTTPException) as exc:
        await fc.fc_qa_reports(
            site_id=SITE, db=session, current_user=_supervisor(), tenant_id=TENANT,
        )

    assert exc.value.status_code == 422
    # The point of the guard: refused BEFORE any signed URL is minted, not after.
    assert called["svc"] is False


@pytest.mark.parametrize("status", ["open", "allocated", "budgeting", "closed"])
async def test_supervisor_may_read_any_site_in_closure(
    status, make_session, fake_result, monkeypatch,
):
    # Every stage the summary page can list stays readable — the guard confines
    # the route to that surface, it does not narrow the access it was added for.
    from app.routers import financial_closure as fc

    called = {"svc": False}
    monkeypatch.setattr(fc, "svc_qa_reports_for_site", _recording_svc(called))
    session = make_session(fake_result(scalar=_site(status)))

    out = await fc.fc_qa_reports(
        site_id=SITE, db=session, current_user=_supervisor(), tenant_id=TENANT,
    )

    assert out == "QA_RESPONSE"
    assert called["svc"] is True


async def test_unknown_site_is_404_not_422(make_session, fake_result, monkeypatch):
    # fetch_site_or_404 runs first inside the guard, so a guessed id is still
    # "not found" rather than a message about its closure state.
    from app.routers import financial_closure as fc

    called = {"svc": False}
    monkeypatch.setattr(fc, "svc_qa_reports_for_site", _recording_svc(called))
    session = make_session(fake_result(scalar=None))

    with pytest.raises(HTTPException) as exc:
        await fc.fc_qa_reports(
            site_id=SITE, db=session, current_user=_supervisor(), tenant_id=TENANT,
        )

    assert exc.value.status_code == 404
    assert called["svc"] is False


async def test_undelegated_executive_is_still_404_before_the_closure_check(
    make_session, monkeypatch,
):
    # Ordering matters: the executive narrowing must stay FIRST, so an executive
    # guessing site ids learns nothing about whether the site is in closure.
    from app.routers import financial_closure as fc

    called = {"svc": False}

    async def _not_delegated(_db, *, tenant_id, site_id, user_id, module):
        return False

    monkeypatch.setattr(fc, "svc_qa_reports_for_site", _recording_svc(called))
    monkeypatch.setattr(fc, "svc_is_delegated", _not_delegated)
    session = make_session()

    with pytest.raises(HTTPException) as exc:
        await fc.fc_qa_reports(
            site_id=SITE, db=session, current_user=_executive(), tenant_id=TENANT,
        )

    assert exc.value.status_code == 404
    assert called["svc"] is False
    # Never even reached the closure lookup.
    assert session.executed == []


def test_the_guard_is_not_inside_the_shared_service():
    """svc_qa_reports_for_site is shared with the project and
    project_excellence routes, which read reports for sites that were never sent
    to closure — that is their whole job. Putting the check inside it would break
    both modules, so it belongs on the closure route. A future tidy-up that
    "consistently" moves it into the service fails here."""
    from app.services import project_service

    src = inspect.getsource(project_service.svc_qa_reports_for_site)
    assert "_assert_closure_open" not in src
    assert "svc_assert_in_closure" not in src
    assert "financial_closure" not in src


def test_admin_detail_route_deliberately_keeps_no_closure_gate():
    """admin-detail is require_role(BUSINESS_ADMIN) and has no status filter by
    design — it is the admin's own endpoint and its sibling admin-detail/{id}
    reads a closure record at any stage. The gap was specific to the FCReader
    route, which supervisors reach."""
    from app.routers import financial_closure as fc

    assert "svc_assert_in_closure" not in inspect.getsource(fc.fc_admin_qa_reports)


def test_the_closure_route_keeps_its_guard():
    from app.routers import financial_closure as fc

    assert "svc_assert_in_closure" in inspect.getsource(fc.fc_qa_reports)


async def test_reading_reports_does_not_insert_a_project_review(
    make_session, fake_result,
):
    """The adjacent waste: svc_qa_reports_for_site used _fetch_review_or_create,
    which INSERTed a project_reviews row inside a SAVEPOINT and then threw it
    away with the rollback a few lines later. Nothing persisted, so it was never
    a write-on-read hole — just an INSERT plus a savepoint on every call to a
    read endpoint."""
    from app.services.project_service import svc_qa_reports_for_site

    session = make_session(
        fake_result(scalar=_site("closed")),   # fetch_site_or_404
        fake_result(scalar=None),              # no project_reviews row for this site
        fake_result(scalars_list=[]),          # no QA reports uploaded
    )

    out = await svc_qa_reports_for_site(session, tenant_id=TENANT, site_id=SITE)

    assert out.before is None and out.after is None
    # A site with no review row reads as never-viewed, exactly as the freshly
    # created row did — and with no pushed report there is nothing to flag.
    assert out.unread is False
    assert session.added == []
    assert session.flush_count == 0
