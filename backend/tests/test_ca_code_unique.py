"""A CA / Commercial Code belongs to exactly one site per workspace.

Before 20260810 nothing stopped two sites carrying the same code. Because
``site.ca_code or site.code`` becomes the display identifier once finance is
filled in, the duplicates then showed up as the same row in every downstream
queue — Legal, Design, Project Excellence, Project, NSO and Launch.

Two layers are tested here: the service pre-check (which names the site already
holding the code) and the translation of a lost race on the unique index into
the same 409 rather than a 500.
"""
from __future__ import annotations

import os
import re
import uuid
from collections import namedtuple

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from app.db import models
from app.services import finance_service as fs

_MIGRATION = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "database", "migrations", "20260810_unique_ca_code_per_tenant.sql",
)


# SQLAlchemy hands back a Row with attribute access; the canned results have to
# match that shape or the test passes against code that could never work.
_ClashRow = namedtuple("_ClashRow", "name code")


def _site(tenant_id: uuid.UUID, **over) -> models.Site:
    """A finance-editable site; `over` sets whatever the case under test needs."""
    defaults = dict(
        id=uuid.uuid4(), tenant_id=tenant_id, status="loi_uploaded",
        name="Capital Walk", city="Gurugram", code="BT-GUR-TKMV",
        ca_code=None, finance_status="pending", kyc_verified=True,
        submitted_by=uuid.uuid4(),
    )
    defaults.update(over)
    return models.Site(**defaults)


def _actor(site: models.Site) -> dict:
    """A supervisor who owns the site — the role both finance writers require."""
    return {"sub": str(site.submitted_by), "name": "Eve Exec", "role": "supervisor"}


# ── The pre-check ────────────────────────────────────────────────────────────

async def test_code_already_used_by_another_site_is_refused(make_session, fake_result):
    """The pre-check names the site holding the code. 'Already in use' alone
    leaves the user hunting the pipeline for the collision."""
    tenant_id = uuid.uuid4()
    site = _site(tenant_id)
    # The clash lookup returns (name, code) of the site already holding the code.
    sess = make_session(
        fake_result(scalar=site),                                  # locked fetch
        fake_result(all_rows=[_ClashRow("Blue Tokai Summit", "CA-300")]),   # clash lookup
    )

    with pytest.raises(HTTPException) as exc:
        await fs.svc_save_finance_draft(
            sess, tenant_id=tenant_id, actor=_actor(site), site_id=site.id,
            ca_code="CA-300",
        )

    assert exc.value.status_code == 409
    # The message has to name the other site — "already in use" alone leaves the
    # user hunting through the pipeline for the collision.
    assert "Blue Tokai Summit" in exc.value.detail
    assert "CA-300" in exc.value.detail
    assert site.ca_code is None, "a refused code must not be written"


async def test_free_code_is_claimed_and_normalised(make_session, fake_result):
    """An unused code is stored upper-cased and trimmed, so the functional
    unique index on upper(ca_code) sees one canonical form."""
    tenant_id = uuid.uuid4()
    site = _site(tenant_id)
    sess = make_session(
        fake_result(scalar=site),
        fake_result(all_rows=[]),  # nobody holds it
    )

    out = await fs.svc_save_finance_draft(
        sess, tenant_id=tenant_id, actor=_actor(site), site_id=site.id,
        ca_code="  ca-300  ",
    )

    # Stored uppercase and trimmed, so 'ca-300' and 'CA-300' cannot coexist.
    assert site.ca_code == "CA-300"
    assert out["ca_code"] == "CA-300"


async def test_resaving_a_sites_own_code_does_not_self_collide(make_session, fake_result):
    """The draft save is idempotent — re-submitting the unchanged form must not
    look up (and trip over) the site's own code."""
    tenant_id = uuid.uuid4()
    site = _site(tenant_id, ca_code="CA-300")
    sess = make_session(fake_result(scalar=site))  # NO clash lookup queued

    out = await fs.svc_save_finance_draft(
        sess, tenant_id=tenant_id, actor=_actor(site), site_id=site.id,
        ca_code="CA-300", finance_amount=250000,
    )

    assert out["ca_code"] == "CA-300"
    assert "upper(sites.ca_code)" not in sess.sql, "no clash query for an unchanged code"


async def test_clash_lookup_is_tenant_scoped_and_excludes_self(make_session, fake_result):
    """Codes are unique per workspace: the query must carry tenant_id (so another
    workspace's identical code is not a conflict) and exclude the site itself."""
    tenant_id = uuid.uuid4()
    site = _site(tenant_id)
    sess = make_session(fake_result(scalar=site), fake_result(all_rows=[]))

    await fs.svc_save_finance_draft(
        sess, tenant_id=tenant_id, actor=_actor(site), site_id=site.id, ca_code="CA-777",
    )

    # Not next(...): a bare generator raises StopIteration when the lookup was
    # never issued, which reads as a crash rather than a failed assertion.
    clash_sqls = [s for s in sess.executed if "upper(sites.ca_code)" in s]
    assert clash_sqls, "no CA-code clash lookup was issued"
    clash_sql = clash_sqls[0]
    assert "sites.tenant_id =" in clash_sql
    assert "sites.id !=" in clash_sql


async def test_request_approval_also_guards_the_code(make_session, fake_result):
    """Both writers claim the code. Guarding only the draft save would let the
    duplicate in through the request-approval payload."""
    tenant_id = uuid.uuid4()
    site = _site(tenant_id)
    sess = make_session(
        fake_result(scalar=site),
        fake_result(all_rows=[_ClashRow("Blue Tokai Summit", "CA-300")]),
    )

    with pytest.raises(HTTPException) as exc:
        await fs.svc_finance_request_approval(
            sess, tenant_id=tenant_id, actor=_actor(site), site_id=site.id,
            ca_code="CA-300", finance_amount=250000,
        )

    assert exc.value.status_code == 409
    assert site.finance_status == "pending", "the workflow must not advance on a refusal"


# ── The lost race (index does the refusing) ──────────────────────────────────

def _integrity_error(message: str) -> IntegrityError:
    """A DB IntegrityError carrying `message`, to drive the lost-race path."""
    class _Orig(Exception):
        sqlstate = "23505"

    return IntegrityError("INSERT", {}, _Orig(message))


def test_unique_violation_becomes_a_409():
    """A lost race that trips the index surfaces as the same 409 the pre-check
    raises — the user should not see a raw constraint error."""
    exc = _integrity_error(
        'duplicate key value violates unique constraint "uq_sites_tenant_ca_code"'
    )
    with pytest.raises(HTTPException) as raised:
        fs._raise_ca_code_conflict(exc, "ca-300")

    assert raised.value.status_code == 409
    assert "CA-300" in raised.value.detail


def test_other_integrity_errors_still_propagate():
    """Only the CA-code index is translated. Swallowing every IntegrityError here
    would hide FK / NOT NULL / CHECK failures behind a misleading 409."""
    exc = _integrity_error('violates foreign key constraint "sites_submitted_by_fkey"')
    with pytest.raises(IntegrityError):
        fs._raise_ca_code_conflict(exc, "CA-300")


# ── The migration ────────────────────────────────────────────────────────────

def test_migration_creates_the_partial_unique_index():
    """The migration is the actual guarantee: partial (so code-less sites do not
    collide) and functional on upper() (so a legacy mixed-case row still clashes)."""
    sql = open(_MIGRATION, encoding="utf-8").read()
    assert re.search(
        r"CREATE UNIQUE INDEX IF NOT EXISTS\s+uq_sites_tenant_ca_code", sql, re.IGNORECASE,
    )
    # Per tenant, case-insensitive, and only over rows that actually have a code.
    assert "tenant_id, upper(ca_code)" in sql
    assert "WHERE ca_code IS NOT NULL" in sql


def test_migration_refuses_to_run_over_existing_duplicates():
    """Creating the index would fail anyway; the DO block makes the deploy log say
    WHICH sites collide instead of a bare constraint error."""
    sql = open(_MIGRATION, encoding="utf-8").read()
    assert "RAISE EXCEPTION" in sql
    assert "HAVING count(*) > 1" in sql


@pytest.mark.asyncio
async def test_index_exists_on_a_provisioned_database():
    """A migration statement that fails is logged and left unrecorded — startup
    continues. So the index silently not existing is a real deploy outcome, and
    the only thing that catches it is asking the database."""
    from sqlalchemy import text

    from app.db import engine

    try:
        async with engine.connect() as conn:
            found = (await conn.execute(text(
                "SELECT 1 FROM pg_indexes "
                " WHERE schemaname = 'public' AND indexname = 'uq_sites_tenant_ca_code'"
            ))).scalar()
    except Exception as exc:  # no database reachable in this environment
        pytest.skip(f"no database available: {exc}")

    assert found == 1, (
        "uq_sites_tenant_ca_code is missing — migration 20260810 did not apply. "
        "Check the startup log for duplicate CA codes blocking it."
    )
