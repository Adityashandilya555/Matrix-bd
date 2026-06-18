# #230 — Unbounded list/history/queue queries → pagination

**Severity:** MEDIUM · performance | **Area:** Part B (backend domain) | **Status:** fixed

## Symptom
History and module-queue endpoints loaded the **entire** tenant-scoped result
set into memory on every call (`.all()` / `.scalars().all()` with no bound). The
history endpoints include completed rows, so the response grew monotonically
with tenant lifetime; FC/PE queues additionally run per-row budget lookups, so an
unbounded queue also multiplied pgBouncer/NullPool round trips.

## Root cause
Pagination had been added to `svc_nso_queue` (and users/notifications/audit/sites)
but the history path and the remaining module queues kept the original unbounded
fetch, and their routers exposed no paging params.

## Fix — safety ceiling + real COUNT (not a 50-row UX page)
The naïve "paginate to 50" of the original spec collides with reality: **every**
queue/history page in the SPA fetches the whole list and derives its KPI tiles
client-side (`items.filter(...).length`), and **none** has a pager (verified
across `frontend/src` — no `loadMore`/`offset`/`IntersectionObserver`). A 50-row
cap would silently truncate lists *and* undercount every KPI. So this fix bounds
memory without breaking the UI:

- **Generous safety ceiling, not a page size.** Each service signature is
  `limit: int = 500, offset: int = 0`; routers use
  `Query(500, ge=1, le=1000)`. The 500 default returns the full set for any
  realistic tenant (so the existing fetch-everything UI and its client-side
  counts keep working unchanged), while capping the pathological/unbounded case
  the issue is about. `restrict_to_site_ids` exec scoping is applied **before**
  the page window, so paging never weakens tenant/exec scoping.
- **`total` is now a real `COUNT(*)`,** not `len(items)`. A shared
  `_common.count_rows(session, stmt)` runs `SELECT count(*)` over the fully
  filtered statement (ORDER BY stripped) *before* `.limit()/.offset()`. So KPI
  headline counts stay exact even if a tenant ever exceeds the 500 ceiling —
  satisfying "KPI shows the real total."

### Services bounded (11) — `limit=500` + real `count_rows` total
| Service | File |
|---|---|
| `svc_nso_queue`, `svc_nso_history` | `nso_service.py` |
| `svc_project_queue`, `svc_project_history` | `project_service.py` |
| `svc_pe_queue` | `project_excellence_service.py` |
| `svc_fc_queue`, `svc_fc_admin_queue` | `financial_closure_service.py` |
| `svc_legal_queue`, `svc_legal_history` | `legal_service.py` |
| `svc_design_queue`, `svc_design_history` | `design_service.py` |
| `svc_get_launch_queue` | `launch_service.py` |

`svc_design_history` and `svc_legal_history` were **still fully unbounded** in the
first pass (the exact class the issue targets) — both now bounded + real-count.
`svc_nso_queue` was already paged but kept `total=len(items)`; it now returns the
real count so the "In NSO" tile (`NsoQueuePage` reads `state.total`) is accurate.

### Routers updated
`nso.py` (queue + history), `project.py` (queue + history),
`project_excellence.py` (queue), `financial_closure.py` (queue + admin-queue),
`legal.py` (queue + **history**), `design.py` (queue + **history**),
`launch_approval.py` (queue). `limit`/`offset` `Query` params were **added** to
the `design`/`legal` history endpoints (previously none).

## Deferred follow-up (frontend, after #237) — the "View more" pager
True row-by-row paging needs a UI affordance that does not exist yet and is **not
covered by any open issue/PR** (the Part-C frontend work — #231/#232/#233/#237/
#239 — adds no pager). Tracked as a follow-up to land **after #237** (shared axios
client) so the load-more logic is written once in the shared client rather than
duplicated across 12 API modules:
- headline KPI tiles bind to the server `total` (now accurate);
- queue/history rows get a **"View more"** button that fetches the next
  `offset` batch and appends;
- once it ships, the backend default can drop from 500 to a real page size.
Until then the 500 ceiling + real `total` keeps every screen correct.

### One judgement call
`svc_get_launch_queue` had **no** `ORDER BY` — pagination needs a stable order, so
a deterministic `created_at DESC` was added (`launch_approvals.created_at` is
non-null). This is the only ordering change; all other queues kept their order.

## Class-wide sweep
Class = *unbounded list/history/queue queries.* Swept
`rg -n '\.scalars\(\)\.all\(\)|\)\.all\(\)' backend/app/services`. The user-facing
list/queue/history endpoints (the 11 above) are now bounded + real-count. The
remainder are **provably bounded** and intentionally not paged — single-row/
`first()` lookups, `{id: row}` maps keyed on an already-bounded `IN (:ids)` set
(batched N+1 fixes), and internal helpers — paging them would break their callers.
The smaller supervisor/admin sub-queues (`svc_legal_rejected_sites`,
`svc_design_gfc_queue`, `svc_design_admin_queue`, PE budget-admin) are short by
construction and left as-is; fold them into the follow-up if needed.

## Tests — `backend/tests/test_pagination_bounds.py`
Parametrised over the bounded services: drives each with an empty
`RecordingSession` result and asserts the emitted SQL carries `LIMIT`, `OFFSET`
**and a real `COUNT(`** (so a regression to `len(items)` is caught). Plus unit
tests for `count_rows` (returns the COUNT scalar, strips ORDER BY, `None → 0`).
**Prove-first** — fails on the pre-fix code, passes after. Full backend suite green.

## Regression guard
The parametrised test fails the instant any of these queries loses its bound or
its real COUNT. A new list endpoint that forgets either is caught by adding it to
the parametrisation. The 500/1000 defaults keep every existing caller — and the
fetch-everything UI — working unchanged.

## Verify
```
cd backend && .venv/bin/pytest tests/test_pagination_bounds.py -q
cd backend && .venv/bin/pytest -q     # full suite green (188 passed on this branch)
# manual: GET /api/nso/history?limit=1001 -> 422 (Query le=1000)
```
