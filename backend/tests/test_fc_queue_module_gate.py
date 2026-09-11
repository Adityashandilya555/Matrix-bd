"""The financial-closure QUEUE is readable without the project module claim.

The Launch Sites page shows this queue as a tab. That page has no module gate of
its own — its supervisors and executives hold whichever module they were
onboarded into (commonly ``nso``) — so ``require_module("project")`` on the queue
403'd nearly all of them and the tab would have been empty for almost everyone.

Reading which sites are in closure is not project-privileged. ACTING on one still
is, so these tests pin BOTH halves: the queue is open to the role guard alone,
and every mutating endpoint on the router keeps its module gate. A future tidy-up
that "consistently" re-adds the gate to the queue, or quietly drops it from a
write, fails here.

The router spells the gate as a ``_module`` parameter, so its presence in the
signature is the gate's presence — checked directly rather than by scanning text.
"""
from __future__ import annotations

import inspect

import pytest

from app.routers import financial_closure as fc

# Everything that CHANGES a closure. Each must keep require_module("project").
_MUTATING = (
    "allocate_fc",
    "revoke_fc_allocation",
    "save_fc_budget",
    "review_fc_budget",
)


def _params(fn):
    return inspect.signature(fn).parameters


def test_queue_has_no_project_module_gate():
    assert "_module" not in _params(fc.fc_queue)


def test_queue_still_requires_a_role():
    # Dropping the module gate must not have dropped the role guard with it —
    # current_user is annotated FCMember (supervisor | executive).
    assert "current_user" in _params(fc.fc_queue)


def test_queue_still_scopes_executives_to_their_allocations():
    # The executive narrowing is the other half of what contains this endpoint.
    src = inspect.getsource(fc.fc_queue)
    assert "_is_executive" in src
    assert "restrict_to_site_ids" in src


@pytest.mark.parametrize("name", _MUTATING)
def test_mutating_endpoints_keep_the_module_gate(name):
    assert "_module" in _params(getattr(fc, name)), (
        f"{name} lost require_module('project') — writes stay project-gated."
    )


def test_the_gate_is_still_defined_and_used():
    # If InProjectModule were removed outright the mutating checks above would
    # pass vacuously on a signature that no longer gates anything.
    assert hasattr(fc, "InProjectModule")
