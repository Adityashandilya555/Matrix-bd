# Developer setup

## Prerequisites

- Python 3.11 or newer
- Node.js 18 or newer
- npm
- PostgreSQL/Supabase connection for HTTP mode

> **Source of Truth**
> - `backend/pyproject.toml:7-28`.
> - `frontend/package.json:6-9`.
> - `Makefile:1-8`.

## Install and run

```bash
make install
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
make dev
```

The backend runs on `http://localhost:8000`; Vite runs on `http://localhost:5173`.

Useful commands:

```bash
make api
make web
make smoke
```

> **Source of Truth**
> - `Makefile:10-49` — install, run, and smoke commands.

## Minimum local configuration

Backend:

- `ALLOW_INSECURE_DEFAULTS=true` only for local development.
- `ENABLE_DOCS=true` to expose `/api/docs`.
- `DATABASE_URL=postgresql+asyncpg://...`.
- `SUPABASE_JWT_SECRET` for token signing.
- Storage URL/service-role key only when testing uploads.

Frontend:

- `VITE_API_BASE_URL=http://localhost:8000/api`.
- `VITE_USE_MOCK=false` for real API behavior or `true` for offline UI work.

> **Source of Truth**
> - `backend/.env.example:1-63`.
> - `frontend/.env.example:1-23`.
> - `backend/app/core/config.py:21-115,149-201` — typed config and unsafe-default guard.

## Database setup

Do not execute `schema.sql` as a bootstrap script. It is an onboarding snapshot. Apply numbered migrations in order to the target database and verify whether held destructive migrations are authorized before running them.

For Supabase’s transaction pooler, use port `6543` and the `postgresql+asyncpg` scheme. The engine disables asyncpg prepared-statement caching and SQLAlchemy pooling for pooler URLs.

> **Source of Truth**
> - `backend/database/schema.sql:1-9`.
> - `backend/database/migrations/202606145_drop_legacy_project_budget.sql:1-9` — held migration example.
> - `backend/app/db/session.py:31-66` — direct vs pooler configuration.

## Mock mode

Set:

```dotenv
VITE_USE_MOCK=true
```

Use it for visual work and frontend interaction without a backend. Switch back to HTTP mode before validating auth, permissions, transaction behavior, uploads, or real API contracts.

> **Source of Truth**
> - `frontend/.env.example:6-12`.
> - `frontend/src/services/api/adapters/index.js:1-14`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Backend refuses to boot | Real JWT secret, or local-only `ALLOW_INSECURE_DEFAULTS=true` |
| `/api/health` works but `/api/health/db` fails | `DATABASE_URL`, asyncpg scheme, credentials, migration state |
| Browser reports CORS | Exact frontend origin in `CORS_ORIGINS` |
| UI calls wrong host | `VITE_API_BASE_URL` includes `/api` |
| Upload returns `503` | Storage project URL and service-role key are configured |
| Upload returns `502` | Storage service rejected or could not receive the object |
| Duplicate prepared statement | Use the Supabase pooler detection/configuration in `db/session.py` |

> **Source of Truth**
> - `backend/app/main.py:180-220,301-313` — startup and health checks.
> - `backend/app/core/config.py:44-68` — CORS.
> - `frontend/src/services/api/adapters/httpAdapter.js:21-30,126-128` — frontend base URL.
