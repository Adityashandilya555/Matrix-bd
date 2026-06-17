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

## Fix (minimal, behaviour-preserving — mirrors `svc_nso_queue`)
For each service: added `limit: int = 50, offset: int = 0` to the keyword-only
signature and chained `.limit(limit).offset(offset)` onto the **existing** ordered
statement (order_by, joins, filters, `restrict_to_site_ids` scoping untouched).
For each router: added `limit: int = Query(50, le=200), offset: int = Query(0, ge=0)`
and forwarded them. `total = len(items)` page semantics preserved (no frontend
contract drift). Executive `restrict_to_site_ids` scoping is applied **before**
the page window, so paging never weakens tenant/exec scoping.

### Services paginated (9)
| Service | File |
|---|---|
| `svc_nso_history` | `nso_service.py` |
| `svc_project_queue`, `svc_project_history` | `project_service.py` |
| `svc_pe_queue` | `project_excellence_service.py` |
| `svc_fc_queue`, `svc_fc_admin_queue` | `financial_closure_service.py` |
| `svc_legal_queue` | `legal_service.py` |
| `svc_design_queue` | `design_service.py` |
| `svc_get_launch_queue` | `launch_service.py` |

### Routers updated (8)
`nso.py` (history), `project.py` (queue + history), `project_excellence.py`
(queue), `financial_closure.py` (queue + admin-queue), `legal.py` (queue),
`design.py` (queue), `launch_approval.py` (queue). `Query` added to the fastapi
import of `project.py`, `project_excellence.py`, `financial_closure.py`,
`design.py` (the others already imported it).

### One judgement call
`svc_get_launch_queue` had **no** `ORDER BY` — pagination needs a stable order, so
a deterministic `created_at DESC` was added (`launch_approvals.created_at` is
non-null). This is the only ordering change; all other queues kept their order.

## Class-wide sweep
Class = *unbounded list/history/queue queries.* Swept
`rg -n '\.scalars\(\)\.all\(\)|\)\.all\(\)' backend/app/services`. The 70 raw hits
were triaged: the 9 above are the user-facing list/queue/history endpoints and are
now bounded. The remainder are **provably bounded** and intentionally not paged —
single-row/`first()` lookups, `{id: row}` maps keyed on an already-bounded
`IN (:ids)` set (batched N+1 fixes), and internal helpers — paging them would
break their callers. (Two identity comprehensions in `notification_service.py`
are a separate quality nit handled in #238.)

## Tests — `backend/tests/test_pagination_bounds.py`
Parametrised over all 9 services: drives each with an empty `RecordingSession`
result and asserts the emitted SQL carries `LIMIT` and `OFFSET`. **Prove-first** —
fails on the pre-fix code (no bound), passes after. Full backend suite green.

## Regression guard
The parametrised test fails the instant any of these queries loses its bound. A
new list endpoint that forgets pagination is caught by adding it to the
parametrisation. Defaults (50/0) keep every existing caller working.

## Verify
```
cd backend && .venv/bin/pytest tests/test_pagination_bounds.py -q
cd backend && .venv/bin/pytest -q     # full suite green
# manual: GET /api/nso/history?limit=201 -> 422 (Query le=200)
```
