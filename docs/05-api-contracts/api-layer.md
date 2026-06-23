# API layer

All backend routes are mounted under `/api`. The frontend base URL must already include `/api`; service functions append paths such as `/sites` or `/auth/whoami`.

## Adapter contract

Components call public services, not Axios or adapters:

```text
component → siteService/moduleApi → adapter index → mockAdapter | httpAdapter
```

Mock mode is selected at build time with `VITE_USE_MOCK=true`. HTTP mode attaches a bearer token, refreshes near-expiry tokens, converts errors to `ApiError`, and uses a longer timeout for multipart uploads.

> **Source of Truth**
> - `frontend/src/services/api/adapters/index.js:1-14` — adapter selection.
> - `frontend/src/services/api/siteService.js:1-20,104-180` — public site API.
> - `frontend/src/services/api/adapters/httpAdapter.js:21-30,54-159` — HTTP behavior.

## Endpoint groups

The router file and Pydantic schema are the contract. This table is an inventory, not a duplicated field-by-field OpenAPI document.

| Prefix | Responsibility | Primary router |
| --- | --- | --- |
| `/auth` | Login checks, login, refresh, logout, signup, password setup/reset | `routers/auth.py` |
| `/tenancy` | Workspace requests, branding, platform-admin operations | `routers/tenancy.py` |
| `/users` | Current user, active users, pending users, role assignment | `routers/users.py` |
| `/sites` | Canonical site reads, status aliases, files, finance, LOI | `routers/sites.py` |
| `/bd` | BD-specific drafts, shortlist, legal status, change requests | `routers/bd.py` |
| `/loi` | LOI upload, view, timeline | `routers/loi.py` |
| `/staging` | Role-specific staging lists and legal handoff | `routers/staging.py` |
| `/audit` | Tenant and per-site audit feeds | `routers/audit.py` |
| `/notifications` | Current user’s in-app notification feed | `routers/notifications.py` |
| `/legal` | DD, agreements, licensing, legal delegations and review | `routers/legal.py` |
| `/design` | Design queues, allocation, deliverables, GFC | `routers/design.py` |
| `/project` | Project queues, allocation, milestones, quality audit, NSO | `routers/project.py` |
| `/project-excellence` | GFC budget and quality-audit completion | `routers/project_excellence.py` |
| `/nso` | NSO queue, history, stages, final approval | `routers/nso.py` |
| `/launch-approvals` | Launch validation loop and launch action | `routers/launch_approval.py` |
| `/financial-closure` | Closure queues, allocation, budget, finalization | `routers/financial_closure.py` |
| `/business-admin` | Tenant-admin queues and decisions | `routers/business_admin.py` |
| `/supervisor-codes` | Supervisor invite code and team operations | `routers/supervisor_codes.py` |
| mixed paths | Site/module delegations | `routers/delegations.py` |

> **Source of Truth**
> - `backend/app/main.py:297-298` — router registration.
> - `backend/app/routers/*.py` — exact path, method, dependency, and response model.

## Core site shapes

`CreateDraftRequest` accepts identity, location, model, map, and commercial fields. `PatchSiteStatusRequest` carries a canonical `SiteStatus` plus transition-specific payload. `SiteResponse` returns persisted site fields plus joined/derived detail, approval, project, NSO, launch, finance, and archive fields. Lists use `{items, total}`.

> **Source of Truth**
> - `backend/app/domain/schemas/site.py:53-159` — site requests.
> - `backend/app/domain/schemas/site.py:164-247` — site responses.
> - `frontend/src/services/api/adapters/httpAdapter.js:204-336` — response mapping and list shape.

## Error contract

| Failure | Expected HTTP behavior | Frontend behavior |
| --- | --- | --- |
| Pydantic validation | `422` with detail array | Flattens messages into one `ApiError.detail` |
| Invalid state transition | `422` | Action rejects; UI displays service error |
| Missing/expired token | `401` | One refresh attempt; then session-expiry event |
| Wrong role/module/object | `403` | No automatic retry |
| Missing tenant-scoped record | `404` | Treat as unavailable/inaccessible |
| Duplicate/current-state conflict | `409` | Caller must refresh or change action |
| Missing storage config | `503` | Upload fails explicitly |
| Storage upstream failure | `502` | Upload remains failed; DB metadata is not written |
| Unexpected exception | sanitized `500` with `request_id` | `ApiError`, preserving readable detail |
| Timeout/network | status `0`, code `TIMEOUT` or network detail | Retry only when the page chooses to |

> **Source of Truth**
> - `frontend/src/services/api/adapters/httpAdapter.js:100-159` — `ApiError`.
> - `backend/app/domain/state_machine.py:52-58` — invalid transitions.
> - `backend/app/main.py:277-294` — sanitized 500.
> - `backend/app/services/storage_service.py:53-58,97-120` — storage failures.

## File uploads

Uploads use multipart field name `file`. The browser uses a 120-second default upload timeout. The backend caps body size, validates ownership/type in the relevant service, uploads to storage, then writes metadata.

> **Source of Truth**
> - `frontend/src/services/api/adapters/httpAdapter.js:23-28,403-440` — multipart construction and timeout.
> - `backend/app/routers/sites.py:337-364,474-486` — photo and LOI endpoints.
> - `backend/app/core/uploads.py` — body cap and type validation entrypoint.
