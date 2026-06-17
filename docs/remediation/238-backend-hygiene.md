# #238 — Backend hygiene: unused imports/args, globals, comprehensions

**Severity:** LOW · tech-debt | **Area:** Part B | **Status:** fixed

Low-risk tidy-up. The one rule that matters: **FastAPI `Depends(...)` params that
look unused are NOT unused** — they run the auth/RBAC side-effect. Only the
genuinely-unused items below were touched; every change is ruff-proven and
suite-verified.

## What changed (by sub-task)

### 16.1 — 11 unused imports (F401)
`ruff --select F401 --fix` removed exactly 11: `models.py` (`String`,
`relationship` — `Mapped`/`mapped_column` kept), `bd.py`/`sites.py`
(`CurrentUser`), `tenancy.py` (`func`), `project.py` (`date`),
`bd_status_service.py` (`ChangeRequestResponse`), `project_service.py` (`date`,
`uuid4`, `svc_assigned_sites` — `svc_is_delegated` kept),
`site_tracker_service.py` (`SiteStatus`).

### 16.2 / 16.4 — genuinely-unused service args
Underscore-prefixed (kept for call-site uniformity, callers pass positionally):
`_compute_stage(_site, row, _project, _licensing)`, `_queue_item(_session, …)`,
`recipients_for_site_owner(_session, *, site)`. (`svc_save_stage_two`'s `body`
ARG was already resolved honestly in #229.)

### 16.3 — ~24 side-effect-only `Depends(require_role(...))` router params
Renamed the **ruff-proven-unused** `current_user` params to `_auth` across
audit/business_admin/design/financial_closure/launch_approval/legal/nso/project/
project_excellence/tenancy/users routers. The `Annotated[..., Depends(...)]` type
is unchanged, so the 403 RBAC enforcement still runs — only the (unused) local
name changed. Handlers that **do** use `current_user` were never flagged and were
left untouched. `main.py` (Part A, framework-contract `app`/`exc`) was left as-is.

### 16.5 / 16.6 — two `global` rebinds removed (PLW0603)
`ratelimit._LAST_PRUNE` → one-element `_PRUNE_STATE` list; `storage_service._client`
→ a tiny `_holder` object. No `global` statement, identical behaviour, no
`threading.Lock` (premature on a single-event-loop process). The conftest reset
fixture was updated to `storage_service._holder.client`.

### 16.7 — trivial comprehensions (C416)
Two identity list comprehensions in `notification_service.py` → `list(...)`; two
`{k: v for k, v in rows}` dict comprehensions (`_common.py`,
`business_admin_service.py`) → `dict(rows)`.

## Class-wide sweep
`ruff check backend --select F401,F811,ARG,W0603,C416,C417` → all genuinely-unused
items fixed; **FastAPI `Depends` params kept** (the false positives the audit
separated out). Post-fix counts: F401 0, ARG001 0 (routers + services), C416/C417
0, PLW0603 0.

## Tests
- `tests/test_hygiene_globals.py` (new): asserts no `global` in the refactored
  functions, that `_prune` still dedups within 60s via the container, and that the
  storage holder still reuses + resets.
- `tests/test_batch_perf_load_readiness.py`: updated 3 direct handler calls
  (`current_user=` → `_auth=`) and the storage assertion (`_client` → `_holder.client`)
  to match the renames.
- `tests/conftest.py`: storage reset fixture updated to the holder.
- **Full backend suite green.**

## Cross-part note (merge ordering)
This PR edits `ratelimit.py` (16.5, the `_prune` global). The plan's critical path
is **#225 → #238** on `ratelimit.py`, and #225 is in flight as PR #243 (it edits
the rate-limit *identifier*, a different function). **Merge #225/#243 before this
PR**, then rebase if needed — the two changes touch different parts of the file but
should be sequenced per the plan.

## Regression guard
Once #223 lands, `ruff --select F401,F811,ARG,W0603,C416,C417 backend/app` in CI
makes the whole class permanent. The hygiene-globals test locks the global removal.

## Verify
```
cd backend && .venv/bin/ruff check app --select F401,ARG001,C416,C417,PLW0603
cd backend && .venv/bin/pytest -q
```
