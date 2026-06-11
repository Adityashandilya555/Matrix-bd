---
name: matrix-bd-modularization
description: Rules for refactoring or extending BD backend code — minimal targeted edits, preserve existing audit trails, keep routers thin. Use before any PR that reorganizes services, adds new route domains, or extracts shared logic.
---

# Matrix BD Modularization

This skill encodes the "minimal targeted edits, preserve existing work" preference for this codebase. A refactor that rewrites working code is a regression risk. A refactor that moves the same logic into a better place with no behavior change is safe.

---

## The architecture contract (do not break)

```
Router (app/routers/)
  └── calls svc_* functions only — no SQL, no ORM, no audit logic
Service (app/services/)
  └── opens transaction → fetches row (tenant-scoped) → validates → mutates
  └── calls write_audit_event + notify_enqueue inside the transaction
  └── commits via transaction() context manager
_common.py
  └── fetch_site_or_404, apply_role_scope, site_to_response — one place only
state_machine.py
  └── assert_transition — called by service, never by router
workflow_unlocks.py
  └── maybe_unlock_design — called by service after gate-field write
```

**Routers are thin.** If you find yourself writing `select()` or `session.execute()` inside a router, stop. Move it to a service function.

**Services are self-contained.** Each `svc_*` function is responsible for its own transaction, audit event, and notification. It does not assume the caller opened a transaction.

---

## What "minimal targeted edit" means in practice

### Adding a new field to an existing flow

1. Add the column to `backend/database/schema.sql` and create a migration.
2. Add the attribute to `backend/app/db/models.py`.
3. Update the relevant `svc_*` function to read/write the field — inside the existing `transaction()` block.
4. Update `site_to_response` in `_common.py` if the field needs to appear in `SiteResponse`.
5. Update the Pydantic schema in `app/domain/schemas/`.

**Do not:** create a new service function for a one-field addition. Do not create a new router endpoint for a field that already belongs to an existing endpoint's payload.

### Adding a new state transition

1. Add the new `SiteStatus` enum value to `state_machine.py`.
2. Add the edge to `ALLOWED_TRANSITIONS`.
3. Update `frontend/src/lib/stateMachine.js` to mirror — the two must stay in sync.
4. Add the `svc_*` function to the appropriate service file (not a new file unless it's a genuinely new domain).
5. Add the route to the appropriate router (not a new router file unless it's a genuinely new domain).

### Adding a new parallel-track field (like `legal_dd_status`, `finance_status`)

These are status columns that live on `sites` but are updated by a different module's service. Pattern:
- The column lives on `models.Site` with a `default=None` / `'pending'` sentinel.
- The module that owns the field reads it via `fetch_site_or_404` (already tenant-scoped).
- If the field completes a multi-gate condition, call `maybe_unlock_design` (or create an analogous helper in `workflow_unlocks.py`) from inside the transaction that sets the field.

---

## When to create a new service file

Create `app/services/x_service.py` only when:
- The new domain has 4+ `svc_*` functions that don't belong with any existing service.
- The domain has its own DB table(s) with no FK to `sites` (or only an optional FK).

Do NOT create a new service file for:
- A handful of helper functions for an existing service. Add them to the existing file with an `# ── Section name ────` separator comment.
- Shared utilities. Add those to `_common.py`.

---

## When to create a new router file

Create `app/routers/x.py` only when:
- The domain is entirely new (new table, new actor type, new workflow).
- The existing router file would exceed ~250 lines after adding the new routes.

When you create a new router, wire it in `app/main.py` alongside the existing routers. Don't create middleware or sub-apps.

---

## Audit trail is non-negotiable

Every status mutation must call `write_audit_event` inside the same `transaction()` block. The audit trail is the product's compliance record — a status change with no audit row is a data integrity bug, not a style issue.

Minimum audit call:
```python
await write_audit_event(
    session,
    tenant_id=tenant_id,
    site_id=site.id,
    actor_id=actor["sub"],
    actor_name=actor["name"],
    action="<snake_case_verb>",         # e.g. "approve_details"
    from_status=old_status,
    to_status=new_status,
)
```

For field edits (not status transitions), use `diff_and_log_pipeline_fields` from `audit_service.py` — it handles the before/after diffing per-field.

---

## Notification calls

Notifications live in `notification_service.py`. Call `notify_enqueue` inside the same transaction as the state change. Don't call it after the commit — the outbox pattern ensures delivery even if the delivery worker is slow.

Available recipient helpers:
- `recipients_for_supervisors(session, tenant_id)` — all active supervisors in the tenant
- `recipients_for_site_owner(session, site)` — the exec who submitted / is assigned
- `recipients_for_legal_supervisors(session, tenant_id)` — legal department supervisors

---

## Preserving existing work — the explicit rules

1. **Do not rename `svc_*` functions** unless you're fixing a genuine naming error. The function name appears in import statements across routers.
2. **Do not change `svc_*` signatures** without updating every call site. Use keyword-only arguments (`*` separator) for new params so old callers get a clear error.
3. **Do not move `_common.py` helpers** into service files. They're shared — anything that de-duplicates them in one service creates a new copy problem elsewhere.
4. **Do not change `SiteStatus` enum string values** — they're persisted in the DB. Rename the Python identifier if needed but keep `= "same_string_value"`.
5. **Do not remove columns from `SiteResponse`** — the frontend depends on them. Deprecate by keeping the field and returning `None`; remove only after verifying frontend no longer reads it.
6. **Do not change `transaction()` semantics** — it's a carefully designed nested-safe helper. If you think you need a different transaction strategy, read `session.py` first.

---

## Checklist before opening a refactor PR

- [ ] No new SQL in any router file
- [ ] No `svc_*` function renamed without grep-confirming all import sites
- [ ] No `SiteStatus` enum string value changed
- [ ] `write_audit_event` called for every status mutation
- [ ] `notify_enqueue` called inside the same transaction as the status change
- [ ] `frontend/src/lib/stateMachine.js` updated if `ALLOWED_TRANSITIONS` changed
- [ ] `site_to_response` in `_common.py` updated if a new field needs API exposure
- [ ] New `svc_*` parameters are keyword-only (`*` separator in signature)
