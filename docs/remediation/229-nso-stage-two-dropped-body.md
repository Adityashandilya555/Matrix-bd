# #229 — `svc_save_stage_two` silently ignored its request body

**Severity:** HIGH · correctness | **Area:** Part B (backend domain) | **Status:** fixed

## Symptom
`POST /api/nso/{site_id}/stage-two` accepted a typed `NsoStageTwoRequest` body
(five status fields: `fssai_status`, `health_trade_status`, `shops_estab_status`,
`fire_noc_status`, `storage_license_status`), returned `200`, and **never read
any of them**. A user checking those boxes believed their input was saved — but
the row was only re-derived from Legal Licensing. Silent data loss behind a
success response.

## Root cause
`backend/app/services/nso_service.py::svc_save_stage_two` was wired with a `body`
parameter to match the router signature, but the implementation only calls
`_sync_rollups(...)` — which recomputes the Stage 2 fields from the site's
canonical **Legal Licensing** record — and writes an audit event. The `body`
fields were never persisted, and ruff flagged the unused parameter (`ARG001`).

## Design decision — Option A (auto-derive), not Option B (user-authored)
Stage 2 is a **read-through reflection** of Legal Licensing, evidenced by:
- `_sync_rollups` derives `stage_two_completed_at` from
  `_legal_licensing_complete(site, licensing)`, not from the body.
- The audit action is `nso_stage_two_reflected` — "refreshed from canonical Legal
  Licensing status."
- Stage 3's unlock reads `site_licensing`, not `nso_reviews`.

So the body is **vestigial**. The fix makes the contract honest without changing
what is persisted (which matches current production behaviour) and is fully
reversible.

## Fix (minimal, behaviour-preserving)
In `svc_save_stage_two`:
1. Signature is now `body: NsoStageTwoRequest | None = None` (the body is
   optional; the router contract still works).
2. A docstring documents the auto-derive intent and how to switch to Option B.
3. When a caller submits a value that **diverges** from the canonical derived
   state, a `WARNING` is logged (`"ignoring submitted status fields …"`) so the
   previously-silent drop is observable. This also makes `body` genuinely used,
   clearing the `ARG001` lint on this function.

No persisted behaviour changed; no router change required.

### To switch to Option B (make the fields user-authored) later
Write `row.<field> = getattr(body, field)` for each of `_STAGE_TWO_STATUS_FIELDS`
before `_sync_rollups`, and ensure they are surfaced in the state response.

## Class-wide sweep
Class = *handlers/services that accept a typed body/param then never reference it
(dropped writes).* Swept with:
```
rg -n 'svc_save_|svc_submit_|svc_update_|svc_finalize_' backend/app/services
```
`svc_save_stage_two` was the dropped-write instance. The remaining `ARG001`
findings (`_compute_stage`, `_queue_item`) are unused-parameter smells, not
dropped writes — they are handled honestly under #238.

## Tests — `backend/tests/test_nso_stage_two_body.py`
- `test_divergent_body_is_logged_not_silently_dropped` — **prove-first**: failed
  on pre-fix code (nothing logged), passes after.
- `test_body_fields_are_not_persisted` — locks the Option-A contract.
- `test_matching_body_does_not_warn` — no noise when values already match.
- `test_body_is_optional` — endpoint works with no body.

## Regression guard
The prove-first test fails the instant the body is dropped silently again. Once
#223 lands, `ruff --select ARG` over `app/services/` in CI guards the class.

## Verify
```
cd backend && .venv/bin/pytest tests/test_nso_stage_two_body.py -q
cd backend && .venv/bin/pytest -q          # full suite green
```
