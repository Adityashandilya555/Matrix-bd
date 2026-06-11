---
name: matrix-bd-concurrency-audit
description: Audit BD backend for concurrency bugs, race conditions, tenant isolation gaps, and workflow_unlocks correctness. Use when reviewing any service that touches sites, legal, finance, design, or project state transitions.
---

# Matrix BD Concurrency Audit

This skill encodes the concurrency and isolation invariants for the Matrix BD backend. Use it whenever a PR touches `backend/app/services/`, `backend/app/domain/state_machine.py`, or `backend/app/services/workflow_unlocks.py`.

---

## The three layers to audit

### 1. State machine (`backend/app/domain/state_machine.py`)

Every status mutation **must** go through `assert_transition()` before writing to the DB. The machine is:

```
draft_submitted → shortlisted → details_submitted → approved → loi_uploaded
    → legal_review → legal_approved → pushed_to_payments  (terminal)
    → legal_rejected → legal_review  (recovery loop)
rejected  (terminal, reachable from any non-terminal)
archived  (terminal, revivable via svc_revive_site)
```

**Concurrency trap — unguarded UPDATE:**
Every `svc_*` function reads `site.status`, validates the transition, then writes `site.status` in the same `async with transaction(session):` block. Without a row lock the read-check-write is a TOCTOU race: two concurrent requests can both pass `assert_transition` and write conflicting statuses.

**Correct pattern (row lock):**
```python
from sqlalchemy import select
stmt = (
    select(models.Site)
    .where(models.Site.id == site_id, models.Site.tenant_id == tenant_id)
    .with_for_update()          # ← row lock held until commit
)
site = (await session.execute(stmt)).scalar_one_or_none()
```

**Current state (as of this audit):** `fetch_site_or_404` in `_common.py` does NOT use `with_for_update()`. Every concurrent pair of requests racing on the same site is a potential double-transition. File: `backend/app/services/_common.py:38`.

**What to flag:**
- Any `fetch_site_or_404` call followed by `assert_transition` + status mutation that does not add `.with_for_update()` to the select.
- Any service that reads `site.status` outside a `transaction()` block.

---

### 2. Tenant isolation (`backend/app/services/_common.py`)

**Invariant:** every query that touches tenant-owned rows must include `tenant_id` in the WHERE clause.

**How the project enforces it:**
- `TenantId` dep (`backend/app/core/deps.py:58`) extracts `tenant_id` from the JWT claim.
- `fetch_site_or_404` always filters `models.Site.tenant_id == tenant_id`.
- `apply_role_scope` adds user-level scoping on top (executive sees only their own sites).

**What to flag:**
- Any `select(models.Site)` that omits `models.Site.tenant_id == tenant_id`.
- Any service function that accepts `site_id` but receives `tenant_id` as `None` or skips it.
- Joins or sub-queries that cross-reference rows from another table (e.g. `LegalDdChecklist`, `Approval`, `ProjectReview`) without a tenant guard on the join condition. These rows inherit tenant from `site_id`; verify the site is scoped before using them.

**Safe pattern (from `_common.py`):**
```python
stmt = select(models.Site).where(
    models.Site.id == site_id,
    models.Site.tenant_id == tenant_id,   # ← required
)
```

---

### 3. `workflow_unlocks.maybe_unlock_design` (`backend/app/services/workflow_unlocks.py`)

Design unlock is a **parallel-gate**: it opens only when BOTH `legal_dd_status='positive'` AND `finance_status='approved'` are set. It is called from two places:
- `legal_service.py:806` — after DDR is approved
- `finance_service.py:288` — after finance is approved

**Invariant check for `maybe_unlock_design`:**

```python
def design_unlock_ready(site: models.Site) -> bool:
    return (
        (site.legal_dd_status or "pending") == "positive"
        and (site.finance_status or "pending") == "approved"
    )
```

Both callers check both fields. It is idempotent — duplicate calls are no-ops because `site.design_status` is only set once.

**Concurrency trap here too:** if both legal and finance writes land simultaneously (unlikely in practice, possible under load), two concurrent `maybe_unlock_design` calls can both see the gate as open and both write `site.design_status = "pending"`. The second write is a no-op but both `write_audit_event` calls fire, producing a duplicate audit entry. No data corruption, but audit noise.

**What to flag:**
- Any new caller of `maybe_unlock_design` that doesn't hold a row lock on `site` before calling.
- Any change to the two gate fields (`legal_dd_status`, `finance_status`) that bypasses `maybe_unlock_design` call.
- Any change to the state machine that adds a new path to `PUSHED_TO_PAYMENTS` without updating the `maybe_unlock_design` check.

---

## `transaction()` semantics (`backend/app/db/session.py:82`)

```python
@asynccontextmanager
async def transaction(session: AsyncSession):
    if session.in_transaction():
        async with session.begin_nested():   # savepoint
            yield session
    else:
        async with session.begin():
            yield session
```

**Key property:** nested calls create savepoints, not new transactions. This means a `flush()` inside a nested `transaction()` is visible to the outer transaction but not yet committed. A rollback in the outer block rolls back the inner flush too.

**What to flag:**
- Service functions that call `session.commit()` directly instead of relying on `transaction()`.
- Service functions that use `session.begin()` directly — those break nesting.
- Services that `flush()` then do a second read expecting the flushed value — correct only because `expire_on_commit=False` is set.

---

## NSO unlock pattern (`backend/app/services/nso_service.py`)

NSO stages unlock sequentially (not via `workflow_unlocks`):
- **Stage 1** unlocks when `legal_dd_status != 'pending'` or `finance_status == 'approved'` (`_trigger_one_unlocked`).
- **Stage 2** unlocks when Stage 1 is complete AND `ProjectReview.project_status == 'completed'`.
- **Stage 3** unlocks when Stage 2 is complete AND project done.

**What to flag:**
- Any new NSO gate field that references `site.status` instead of the parallel-track status columns (`legal_dd_status`, `finance_status`, `design_status`).
- `_trigger_one_unlocked` called outside a fresh `fetch_site_or_404` — it reads `site` attributes that may be stale.

---

## Quick audit checklist

Run this against any PR touching the service layer:

- [ ] `fetch_site_or_404` calls before state mutations use `.with_for_update()`
- [ ] Every query on site-owned rows carries `tenant_id` in WHERE
- [ ] `maybe_unlock_design` is called in the same transaction block as the gate-field write
- [ ] No `session.commit()` called directly in service code
- [ ] New state machine edges are added to `ALLOWED_TRANSITIONS` in `state_machine.py`
- [ ] Frontend `stateMachine.js` mirrors any new edges (it lives at `frontend/src/lib/stateMachine.js`)
- [ ] New terminal states have an empty `[]` transition list in `ALLOWED_TRANSITIONS`
