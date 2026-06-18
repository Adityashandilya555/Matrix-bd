# #240 — Complexity reduction (backend hotspots)

**Severity:** MEDIUM · tech-debt | **Area:** Part B | **Status:** partial — phased (see below)

This issue is **explicitly phased**: *"Do this LAST and ONE hotspot per PR …
behaviour-preserving … each carries regression risk, so each must land with the
full test suite green before/after."* This PR ships the two **surgical,
independently-verifiable** items and documents the four large god-function
extractions as the remaining per-hotspot work.

## Shipped in this PR

### 18.5 — `approve_workspace_request` outbox JSON (a real correctness bug)
The `notification_outbox.payload` was built by **string concatenation** of a JSON
template. A `company`/`city` containing a quote, backslash, or other escapable
char produced **malformed JSON**, and `CAST(:payload AS jsonb)` then threw at
runtime. Replaced with `json.dumps({...})`, which escapes every field correctly.
The now-dead `_json_string` helper was removed.

### 18.6 — `_build_response` N+1 → one batched query
`launch_service._build_response` had an inner `name(uid)` closure called up to 5×
sequentially (one `users` SELECT per actor — each a fresh pgBouncer/NullPool round
trip). Replaced with a single `fetch_user_names(...)` batch + a None-safe
`_name()` lookup. **5 sequential SELECTs → 1.** `fetch_user_name` (now unused) was
dropped from the import.

**Tests** — `backend/tests/test_complexity_hotfixes.py`:
- `test_outbox_payload_is_valid_json_for_special_chars` (18.5) — quotes/backslash/tab round-trip.
- `test_build_response_batches_user_lookups` (18.6) — asserts exactly **one** `users` SELECT (prove-first: pre-fix fired up to 5).

Full backend suite green; the C901 gate (`max-complexity=15`) passes.

## Remaining — phased per-hotspot extractions (one PR each, behaviour-preserving)
These are pure-readability refactors. The C901 gate **already passes at 15**
(`svc_submit_deliverable` is the worst at exactly 15), so none of them is
gate-blocking. They touch live legal/design/provisioning branches (supervisor vs
executive), so each should land in its own PR with added integration coverage —
not batched. Extraction plans:

| Item | Where | Extraction plan |
|---|---|---|
| 18.1 | `tenancy.py::approve_workspace_request` (211 lines) | Create `services/tenancy_service.py`; extract `svc_approve_workspace(db, req_row, payload)` (slug-retry loop + all INSERTs + outbox); keep `_require_platform_admin` + the `FOR UPDATE` lock in the router; same `db.commit()` boundary. |
| 18.2 | `design_service.py::svc_submit_deliverable` (149 lines, McCabe 15) | Extract `_handle_supervisor_self_upload(...)` and `_handle_executive_upload(...)`; resolve `review` + validate stage once, then dispatch by `is_supervisor`. Keep audit + `notify_enqueue` inside the helpers. |
| 18.3 | `legal_service.py::svc_save_verification` (126 lines, McCabe 13) | Extract `_assert_can_edit_dd(...)`, `_apply_dd_fields(...)`, `_maybe_repair_stale_published_dd(...)` (with a docstring on the historical-repair branch). |
| 18.4 | `legal_service.py::svc_save_due_diligence` (122 lines) | Extract `_apply_negative_verdict(...)` / `_apply_positive_verdict(...)`; keep `maybe_unlock_design` + `notify_enqueue` calls in place. |

## Regression guard
The C901 `max-complexity=15` gate (added with the CI substrate in **#223**) blocks
any *new* function over threshold and is the durable lock for this class; it
currently passes. The two prove-first tests lock 18.5 and 18.6.

## Verify
```
cd backend && .venv/bin/pytest tests/test_complexity_hotfixes.py -q
cd backend && .venv/bin/pytest -q
cd backend && .venv/bin/ruff check app --select C901 --config "lint.mccabe.max-complexity=15"
```
