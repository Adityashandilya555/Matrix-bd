# #235 — `set_tenant_branding` held a DB connection across the logo upload

**Severity:** LOW · concurrency/performance | **Area:** Part B | **Status:** fixed

## Symptom
The platform-admin branding handler ran a `SELECT` (which auto-begins a read
transaction on the session) and then `await`ed `storage_upload` — up to a 30s PUT
to Supabase Storage — **before** the `UPDATE` + `commit`. The connection (and,
under NullPool + pgBouncer, a scarce pooler slot) was pinned for the whole upload.
Enough concurrent slow branding calls and the pool starves, timing out unrelated
requests.

## Root cause
This admin handler was not part of the #89 upload-ordering refactor that fixed the
LOI/photo/design upload paths. It reads → uploads → writes, keeping the connection
open across the slow PUT. It holds **no** row lock (`no FOR UPDATE`), so this is a
connection-hold, not a lock blocking other writers.

## Fix (minimal, mirrors #89)
After the `SELECT` and the 404 existence check, capture the plain values we carry
forward (`new_name`, `logo_path`) and call `await db.rollback()` to release the
read transaction/connection **before** the upload. Then upload, then `UPDATE` +
`commit`. Safe because the `UPDATE` targets `WHERE id = :id` and does not depend on
the released read. **No `FOR UPDATE` added** — last-write-wins on branding metadata
is acceptable for this low-contention path (an explicit acceptance criterion).

## Class-wide sweep
Class = *external I/O (storage/email/httpx) awaited while holding a DB
connection/lock/open transaction.* Swept
`rg -n 'with_for_update|async with transaction|upload|storage|httpx|notify' backend/app/services`.
LOI/photo/design were already fixed (#89); `set_tenant_branding` was the last
read-then-upload-then-write instance. No other handler awaits external I/O inside
a connection/lock scope.

## Tests — `backend/tests/test_branding_conn_release.py`
- **prove-first** `test_rollback_precedes_storage_upload`: a probe records
  `session.rollback_count` at the moment `storage_upload` is invoked and asserts a
  rollback already fired (fails pre-fix — 0 rollbacks before upload; passes after).
  Also asserts the write still persists + commits.
- `test_unknown_tenant_404_before_any_upload`: unknown tenant → 404 with no upload
  attempt.

(The DB-free `RecordingSession` can't model real auto-begin, so we assert the
ordering invariant — the established pattern for this repo's concurrency tests.)

## Regression guard
The ordering test fails the instant the upload is moved back inside the
connection's scope. Aligns with the `matrix-bd-concurrency-audit` invariant
"connection released before the storage call."

## Verify
```
cd backend && .venv/bin/pytest tests/test_branding_conn_release.py -q
cd backend && .venv/bin/pytest -q     # full suite green
```
