"""NSO is a supervisor-only module — executives have no access and no team slot."""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.services import business_admin_service, supervisor_code_service


async def test_nso_endpoints_reject_executive_allow_supervisor():
    # The NSO router guard must be supervisor-only (executives get 403).
    from app.routers import nso

    guard = nso.NsoMember.__metadata__[0].dependency  # the require_role(SUPERVISOR) dep

    with pytest.raises(HTTPException) as ei:
        await guard(current_user={"role": "executive"})
    assert ei.value.status_code == 403

    ok = await guard(current_user={"role": "supervisor"})
    assert ok["role"] == "supervisor"


async def test_list_org_marks_nso_supervisor_only_and_hides_execs(make_session, fake_result):
    tenant_id = uuid.uuid4()
    sup_id, exec_id = uuid.uuid4(), uuid.uuid4()
    sess = make_session(
        fake_result(mappings_rows=[]),  # module_codes (none)
        fake_result(mappings_rows=[
            {"module": "nso", "role_in_module": "supervisor", "supervisor_id": None,
             "joined_at": None, "id": sup_id, "email": "s@x.co", "name": "Sup"},
            # An executive membership exists in nso, but it must NOT be surfaced.
            {"module": "nso", "role_in_module": "executive", "supervisor_id": sup_id,
             "joined_at": None, "id": exec_id, "email": "e@x.co", "name": "Exec"},
            # A normal module keeps executives enabled (control).
            {"module": "legal", "role_in_module": "supervisor", "supervisor_id": None,
             "joined_at": None, "id": uuid.uuid4(), "email": "l@x.co", "name": "Legal Sup"},
        ]),
    )

    out = await business_admin_service.list_org(sess, tenant_id)
    by_mod = {m["module"]: m for m in out["modules"]}

    nso = by_mod["nso"]
    assert nso["executives_enabled"] is False
    assert nso["supervisors"] and nso["supervisors"][0]["executives"] == []  # no execs surfaced
    assert nso["unassigned_executives"] == []

    assert by_mod["legal"]["executives_enabled"] is True  # other modules unaffected


async def test_approve_pending_exec_refuses_nso(make_session):
    # Defense-in-depth: an executive can never be activated into NSO.
    with pytest.raises(HTTPException) as ei:
        await supervisor_code_service.approve_my_pending_exec(
            make_session(), tenant_id="t", supervisor_id="s", user_id="u", module="nso",
        )
    assert ei.value.status_code == 400
