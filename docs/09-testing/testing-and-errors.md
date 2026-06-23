# Testing strategy and error handling

CI runs backend lint/tests and frontend lint/build/tests on every pull request and push to `main`.

## Test layers

| Layer | Current mechanism | What it protects |
| --- | --- | --- |
| Backend unit/service | `pytest`, fake async sessions | Business rules, authz, state and transaction ordering |
| Backend contract | Direct router/service calls with Pydantic models | Status codes and request dispatch |
| Frontend unit | Vitest | Pure helpers and adapter mapping |
| Frontend component | Testing Library + jsdom | Guards, contexts, forms, UI errors |
| Build/lint | Ruff, ESLint, Vite build | Syntax, complexity, accessibility, production bundling |
| Live smoke | `/api/health`, `/api/health/db`, manual login/action | Runtime environment and integration |

> **Source of Truth**
> - `.github/workflows/ci.yml:19-63` — CI jobs.
> - `backend/pyproject.toml:21-29` — pytest configuration.
> - `frontend/package.json:10-14` — frontend scripts.

## High-value regression coverage

- Request sessions commit successful writes and roll back failures.
- Executives cannot use supervisor-only status transitions.
- Executives cannot read or upload against another executive’s site.
- Route guards wait for session hydration.
- HTTP adapter maps real wire fields and preserves archive/LOI data.
- Uploads release database transactions before slow storage calls.
- Shared budget, NSO, launch, pagination, and auth refresh paths have focused suites.

> **Source of Truth**
> - `backend/tests/test_write_persistence_regression.py:1-86`.
> - `backend/tests/test_batch_sec_authz.py:1-180`.
> - `frontend/src/router/__tests__/guards.test.jsx:18-48`.
> - `frontend/src/services/api/__tests__/siteAdapter.test.js:10-50`.
> - `backend/tests/test_batch_c_infra.py:316-385`.

## Gaps to preserve or close

There is no dedicated exhaustive test that compares every backend and frontend site-state edge. When the graph changes, add a parity test rather than relying on manual review. There is also no browser E2E suite covering a real database and storage service; critical release validation still needs a live smoke pass.

> **Source of Truth**
> - `backend/app/domain/state_machine.py:27-58` and `frontend/src/lib/stateMachine.js:19-45` — duplicated graph requiring parity coverage.
> - `.github/workflows/ci.yml:19-63` — current CI contains no browser E2E job.

## Validation ownership

| Layer | Validate here |
| --- | --- |
| Component | Immediate UX constraints and required input hints |
| Frontend service | Canonical number conversion and wire adaptation |
| Pydantic schema | Types, ranges, enums, safe URLs |
| Router dependency | Token, role, and module |
| Service | Ownership, current state, self-approval, cross-row business rules |
| Database | PK/FK, uniqueness, checks, and transaction atomicity |

Backend and database validation remain mandatory even when the UI disables an action.

> **Source of Truth**
> - `frontend/src/services/api/siteService.js:8-72,137-158` — numeric normalization.
> - `backend/app/domain/schemas/site.py:8-48,53-159` — input validation.
> - `backend/app/services/bd_service.py:47-84` — domain authorization.
> - `backend/database/schema.sql:25-40,102-113` — database constraints.

## Failure propagation

Service validation raises an HTTP error and the request session rolls back. Unexpected exceptions are logged with a request ID and return sanitized JSON. Axios converts all failures to `ApiError`; contexts store list errors, while action callers normally surface the rejected promise near the form/modal.

Only `401` requests that actually carried a token trigger refresh/session-expiry behavior. Network and `5xx` failures do not clear a valid token.

> **Source of Truth**
> - `backend/app/db/session.py:95-104`.
> - `backend/app/main.py:101-118,277-294`.
> - `frontend/src/services/api/adapters/httpAdapter.js:102-159`.
> - `frontend/src/state/SessionContext.jsx:120-150`.

## Commands

```bash
cd backend
ruff check app
ruff check app/services --select D101,D102,D103
python -m pytest -q

cd ../frontend
npm run lint
npm run build
npm test
```
