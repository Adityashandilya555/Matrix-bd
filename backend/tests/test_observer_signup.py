"""Creating an observer: workspace code → signup → pending → approve.

Mirrors the supervisor flow, with one divergence that these tests exist to pin:
approving an observer must write NO user_module_memberships row. An observer is
workspace-wide, and approve_supervisor() — the obvious thing to copy — inserts a
membership with role_in_module='supervisor' and a module. Doing that for an
observer would either file it as a supervisor of some department or violate the
role_in_module CHECK.
"""
from __future__ import annotations

import inspect
import re

from app.services import auth_repo, business_admin_service as svc


def _body(fn) -> str:
    """Source with the docstring stripped.

    These functions explain in prose what they deliberately do NOT do, so a naive
    substring check over the whole source matches the explanation and fails.
    """
    src = inspect.getsource(fn)
    parts = src.split('"""')
    return parts[0] + "".join(parts[2:]) if len(parts) >= 3 else src


# ── the divergence from the supervisor flow ───────────────────────────────────

def test_approving_an_observer_writes_no_module_membership():
    """The whole reason approve_observer exists instead of reusing the supervisor
    path. If someone later 'simplifies' by delegating to approve_supervisor, this
    fails."""
    body = _body(svc.approve_observer)
    assert "user_module_memberships" not in body
    assert "role_in_module" not in body


def test_approving_an_observer_only_flips_is_active():
    """Nothing else about the row should change on approval."""
    src = _body(svc.approve_observer)
    statements = re.findall(r"\b(INSERT|UPDATE|DELETE)\b", src)
    assert statements == ["UPDATE"], f"expected one UPDATE, found {statements}"
    assert "is_active = true" in src


def test_approve_is_scoped_to_the_observer_role_and_tenant():
    """A user_id from another tenant, or of another role, must not be activated
    by this endpoint."""
    src = _body(svc.approve_observer)
    assert "role = 'observer'" in src
    assert "tenant_id = :tid" in src


def test_approve_is_idempotent_on_resubmit():
    """A double-clicked approve must be a no-op, not a second activation."""
    src = _body(svc.approve_observer)
    assert 'if not target or target["is_active"]:' in src
    assert "return" in src


def test_reject_only_ever_deletes_an_inactive_row():
    """Rejecting must not be able to delete a live observer account."""
    src = _body(svc.reject_observer)
    assert "is_active = false" in src
    assert "role = 'observer'" in src


# ── the workspace code ────────────────────────────────────────────────────────

def test_rotation_revokes_the_old_code_before_minting():
    """Rotating must invalidate the previous code, or 'rotate to revoke access'
    silently does nothing."""
    src = _body(svc.rotate_observer_code)
    revoke_at = src.index("revoked_at = now()")
    insert_at = src.index("INSERT INTO observer_codes")
    assert revoke_at < insert_at, "the new code is minted before the old is revoked"


def test_the_code_lookup_ignores_revoked_codes():
    """A rotated-away code must stop resolving to a tenant."""
    src = _body(auth_repo.get_observer_code)
    assert "revoked_at IS NULL" in src


def test_the_code_lookup_returns_no_module():
    """An observer is workspace-wide; a module column here would be a lie the
    signup path could then act on."""
    assert "module" not in _body(auth_repo.get_observer_code)


def test_codes_are_minted_with_the_shared_generator():
    """Same entropy as dept codes rather than a weaker ad-hoc one."""
    assert "_new_dept_code()" in _body(svc.rotate_observer_code)


# ── the pending queue ─────────────────────────────────────────────────────────

def test_pending_list_is_scoped_to_inactive_observers_of_this_tenant():
    src = _body(svc.list_pending_observers)
    assert "role = 'observer'" in src
    assert "is_active = false" in src
    assert "tenant_id = :tid" in src


# ── the migration ─────────────────────────────────────────────────────────────

def _migration() -> str:
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[1]
    return (root / "database/migrations/20260817_observer_codes.sql").read_text()


def test_only_one_live_code_per_workspace_is_enforced_by_the_database():
    """Not by the rotation code remembering to revoke first."""
    sql = _migration()
    assert "uq_observer_codes_live_per_tenant" in sql
    assert "WHERE revoked_at IS NULL" in sql


def test_the_table_has_no_module_column():
    """Workspace-wide by construction, not by convention."""
    sql = _migration()
    body = sql[sql.index("CREATE TABLE"):sql.index(");")]
    assert "module" not in body


def test_revoked_codes_are_kept_as_history():
    """Rotation revokes and inserts rather than overwriting, so who held which
    code and when stays answerable."""
    src = _body(svc.rotate_observer_code)
    assert "SET code =" not in src
