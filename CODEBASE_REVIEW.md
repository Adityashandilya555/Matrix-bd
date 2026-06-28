# Matrix-BD Codebase Review

> **Generated:** 2026-06-16  
> **Scope:** Full repository — `backend/`, `frontend/`, `z-matrix-design-system/`, config & infra  
> **Reviewer:** Automated static analysis + Qodo AI (PR #1)  
> **Status:** Living document — update after each sprint

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Architecture](#3-architecture)
4. [Directory Structure](#4-directory-structure)
5. [API Endpoints (All Routers)](#5-api-endpoints-all-routers)
6. [Authentication & Authorization](#6-authentication--authorization)
7. [Database Layer](#7-database-layer)
8. [Frontend Architecture](#8-frontend-architecture)
9. [Design System](#9-design-system)
10. [Security Findings](#10-security-findings)
11. [Code Quality & Bugs](#11-code-quality--bugs)
12. [Test Coverage](#12-test-coverage)
13. [Pending / Incomplete Work](#13-pending--incomplete-work)
14. [Dependency Risks](#14-dependency-risks)
15. [Recommendations Summary](#15-recommendations-summary)

---

## 1. Project Overview

**Matrix-BD** is a multi-tenant **Business Development (BD) operations platform** built for Blue Tokai Coffee to manage retail site acquisitions end-to-end. It tracks a site from initial scouting through shortlisting, legal due diligence, and financial closure before handing off to an NSO (New Store Opening) team.

**Domain workflow (state machine):**

```
DRAFT_SUBMITTED → SHORTLISTED → DETAILS_SUBMITTED → APPROVED
    → LOI_UPLOADED → LEGAL_REVIEW → LEGAL_APPROVED
    → PUSHED_TO_PAYMENTS  (terminal)
         ↘ REJECTED  (terminal)
         ↘ ARCHIVED  (terminal)
    LEGAL_REJECTED → LEGAL_REVIEW  (recovery loop via Change Request)
```

**Tenancy model:** Multi-tenant (each tenant = a company/org). Role claims (`role`, `tenant_id`, `city`, `module`) are encoded in Supabase JWTs and re-validated against the DB on every request.

---

## 2. Tech Stack

### Backend

| Layer | Technology |
|---|---|
| Language | Python 3.11 |
| Framework | FastAPI (async) |
| ORM | SQLAlchemy 2.0 (async, mapped_column style) |
| Database | PostgreSQL via Supabase |
| Auth | Supabase JWTs (HS256), decoded + re-validated per request |
| File storage | Supabase Storage |
| Config | pydantic-settings v2 (`Settings` with model validators) |
| Linting | Ruff (E, W, F, I, UP, B, ASYNC, S rules) |
| Security scanner | Bandit |
| Rate limiting | In-process sliding window (`app/core/ratelimit.py`) |
| Test runner | pytest + pytest-asyncio |

### Frontend

| Layer | Technology |
|---|---|
| Language | JavaScript (ES2022+) |
| Framework | React 18 + Vite |
| Routing | React Router v6 |
| HTTP | axios (auth flow) + custom `apiFetch` wrapper (data) |
| State | React Context (`SessionContext`, `SitesContext`) + custom hooks |
| Env | `VITE_*` env vars, mock adapter via `VITE_USE_MOCK` |

### Infrastructure

| Component | Platform |
|---|---|
| Frontend | Vercel (pending deployment) |
| Backend | Railway / Render / Fly.io (pending, not Vercel) |
| DB + Auth | Supabase (hosted PostgreSQL + Auth) |
| Storage | Supabase Storage (LOI documents, images) |

---

## 3. Architecture

### Backend request lifecycle

```
HTTP Request
  → FastAPI router
  → Depends(get_current_user)        ← verifies JWT, re-reads role/is_active from DB
  → Depends(require_role(...))       ← RBAC guard (role enum check)
  → Depends(require_module(...))     ← Module isolation guard (optional, on module routes)
  → Route handler
      → Service layer (app/services/)
          → async with transaction(db): ...   ← SQLAlchemy async session
              → DB writes
          → Supabase Storage (file uploads)
  → Pydantic response model
  → JSON response
```

### Auth flow

```
Browser → POST /api/auth/login  { email, workspace_code }
  ← 200 { access_token, user }   (token valid 24h)
  ← 202                          (account pending role assignment)

Browser attaches: Authorization: Bearer <token>

On expiry: POST /api/auth/refresh  { token }
  ← new token if within REFRESH_GRACE_SECONDS (7 days) of expiry
  ← 401 if beyond grace window
```

### State management (frontend)

```
SessionContext  → user identity, token, login/logout
SitesContext    → cached site list, invalidation events
siteEvents.js   → pub/sub bus (CustomEvent) for cross-component refresh
useSiteDataRefresh() → subscribes hooks to siteEvents + window focus
```

---

## 4. Directory Structure

```
Matrix-bd/
├── backend/
│   └── app/
│       ├── main.py                     ← FastAPI app factory, router mounts, CORS
│       ├── core/
│       │   ├── config.py               ← Settings (pydantic-settings), env validation
│       │   ├── deps.py                 ← get_current_user, get_db, CurrentUser type
│       │   ├── security.py             ← JWT encode/decode, decode_token_for_refresh
│       │   ├── passwords.py            ← Password hashing (bcrypt)
│       │   ├── ratelimit.py            ← In-process sliding-window rate limiter
│       │   └── uploads.py             ← read_upload_capped, MIME allowlist
│       ├── db/
│       │   ├── models.py               ← SQLAlchemy ORM models (Site, User, ...)
│       │   ├── session.py              ← AsyncSession factory, transaction() ctx mgr
│       │   └── base.py                 ← DeclarativeBase
│       ├── domain/
│       │   ├── state_machine.py        ← SiteStatus enum + ALLOWED_TRANSITIONS
│       │   └── schemas/                ← Pydantic request/response schemas (20 files)
│       ├── rbac/
│       │   ├── roles.py                ← Role enum
│       │   ├── permissions.py          ← PERMISSIONS dict + can() helper
│       │   └── guards.py               ← require_role(), require_module(), require_scope()
│       ├── routers/                    ← 20 FastAPI routers (see §5)
│       ├── services/                   ← Business logic (one file per domain)
│       └── tests/                      ← pytest test suite
├── frontend/
│   └── src/
│       ├── services/api/               ← HTTP adapter, auth, site/user services
│       ├── state/                      ← SessionContext, SitesContext, hooks
│       ├── components/                 ← React UI components
│       └── pages/                      ← Route-level page components
├── z-matrix-design-system/             ← Design tokens, CSS, preview HTML, UI kits
├── docs/                               ← API docs, architecture notes
├── .github/workflows/
│   └── qodo-review.yml                 ← AI code review pipeline (Qodo PR-Agent)
├── CLAUDE.md                           ← AI assistant operational rules
├── DEPLOYMENT.md                       ← Deployment guide
├── left_out_tasks.md                   ← Pending integration checklist
├── Makefile                            ← Dev shortcuts (make dev, make lint, ...)
└── pyproject.toml                      ← Ruff + Bandit config
```

---

## 5. API Endpoints (All Routers)

| Router file | Prefix | Key endpoints |
|---|---|---|
| `auth.py` | `/api/auth` | `POST /login`, `POST /refresh`, `GET /whoami` |
| `sites.py` | `/api/sites` | `GET /`, `POST /`, `GET /{id}`, `PATCH /{id}` |
| `bd.py` | `/api/bd` | BD workflow actions (shortlist, approve, reject, archive) |
| `users.py` | `/api/users` | `GET /`, `GET /me`, `POST /`, `PATCH /{id}` |
| `tenancy.py` | `/api/tenancy` | Tenant management, workspace code |
| `business_admin.py` | `/api/admin` | Platform admin portal (password-gated) |
| `loi.py` | `/api/loi` | LOI upload, download, timeline |
| `legal.py` | `/api/legal` | Due diligence queue, DD save/finalize, agreement, licensing |
| `audit.py` | `/api/audit` | Audit log reads |
| `delegations.py` | `/api/delegations` | Supervisor delegation management |
| `design.py` | `/api/design` | Design module deliverables |
| `financial_closure.py` | `/api/financial` | Financial closure steps |
| `launch_approval.py` | `/api/launch` | Launch approval workflow |
| `notifications.py` | `/api/notifications` | In-app notifications |
| `nso.py` | `/api/nso` | NSO queue, stage gates |
| `project.py` | `/api/project` | Project tracking |
| `project_excellence.py` | `/api/project-excellence` | Quality audit gates |
| `staging.py` | `/api/staging` | Staging environment helpers |
| `supervisor_codes.py` | `/api/supervisor-codes` | Supervisor code management |

**Total:** ~20 routers, estimated 80–120 individual endpoints.

---

## 6. Authentication & Authorization

### JWT verification (`app/core/security.py`)

- Algorithm: **HS256** with `SUPABASE_JWT_SECRET`
- Audience: validated against `SUPABASE_JWT_AUDIENCE` setting
- Required claims: `exp`, `sub`
- On every request: `users.is_active` + `role` is re-read from DB (kills stale tokens immediately)
- Refresh: `decode_token_for_refresh` allows tokens expired within 7-day grace window

### RBAC (`app/rbac/`)

```python
# Role hierarchy
Role.EXECUTIVE        # BD field executive — creates/submits sites
Role.SUPERVISOR       # BD supervisor — shortlists, approves, sends to legal
Role.BUSINESS_ADMIN   # Tenant admin — manages users
Role.SYSTEM           # Internal system role
```

- `require_role(*roles)` — FastAPI `Depends` guard, raises 403
- `require_module(module_name)` — orthogonal module isolation (legal, payments)
- `can(role, action)` — utility for programmatic checks

### Demo user (`app/core/deps.py`)

```python
# RISK: if ALLOW_ANON_DEMO_USER=true in production,
# any unauthenticated request gets executive access
_DEMO_USER = { "role": "executive", "tenant_id": "...demo...", ... }
```

---

## 7. Database Layer

### Session management (`app/db/session.py`)

- `AsyncSession` per request via FastAPI `Depends(get_db)`
- `transaction(session)` context manager: opens real transaction if none exists, or a SAVEPOINT if already in a transaction
- **Known regression fixed (#103):** the `is_active` DB read in `get_current_user` was auto-beginning a transaction, causing all subsequent writes to silently roll back (SAVEPOINTs don't commit the outer tx). Fixed by `await db.rollback()` after the read-only check.

### Key ORM models

| Model | Table | Notes |
|---|---|---|
| `Site` | `sites` | Core entity; ~40 columns including all state timestamps |
| `User` | `users` | `id` = Supabase auth UUID; `role`, `is_active`, `tenant_id` |
| `AuditLog` | `audit_logs` | Immutable event log per state transition |
| `LegalDD` | `legal_dd` | 4-step legal due diligence checklist |
| `Notification` | `notifications` | In-app notification store |

### Site model fields (abbreviated)

```
id, tenant_id, status (SiteStatus), city, location, address
google_maps_pin, google_maps_url
expected_rent, rent_type, expected_escalation_pct, expected_escalation_years
expected_revshare_pct, rent_set_at
submitted_by → users.id, assigned_to → users.id, supervisor_id → users.id
draft_submitted_at, shortlisted_at, details_submitted_at, approved_at,
loi_uploaded_at, pushed_to_payments_at, rejected_at, archived_at
```

---

## 8. Frontend Architecture

### API layer (`frontend/src/services/api/`)

| File | Purpose |
|---|---|
| `client.js` | `apiFetch` wrapper — attaches `Authorization: Bearer` header, throws on non-2xx |
| `supabaseAuth.js` | `signInWithWorkspaceCode()`, `signOut()`, token storage |
| `authToken.js` | `getAuthToken()`, `setAuthToken()`, `clearAuthToken()` — in-memory + localStorage |
| `siteService.js` | `listSites()`, `getSite()`, `createSite()`, `patchSite()` |
| `userService.js` | `listUsers()`, `me()` |
| `siteEvents.js` | pub/sub bus for cross-component data invalidation |
| `adapters/` | HTTP adapter (real backend) + mock adapter (`VITE_USE_MOCK=true`) |

### State management

```
SessionContext
  → user: { id, email, name, role, tenantId, city, module }
  → token: string | null
  → login(email, code) → calls supabaseAuth.signInWithWorkspaceCode
  → logout()

SitesContext
  → sites: Site[]
  → loading, error
  → refresh() → re-fetches from /api/sites
```

### Custom hooks

| Hook | Purpose |
|---|---|
| `useSiteDataRefresh(refresh)` | Subscribes to siteEvents + window focus/visibility for auto-refresh |
| `useLaunchSites()` | Fetches `pushed_to_payments` sites filtered by `projectStatus === 'done'` |
| `useFocusSite()` | Deep-link `?focus=<id>` — scrolls + highlights a row in a list |
| `useAuthToken()` | Reads token from SessionContext |

---

## 9. Design System

Located at `z-matrix-design-system/project/`:

- `colors_and_type.css` — CSS custom properties for all color tokens and typography scale
- `preview/*.html` — Static preview pages for every token category (colors, spacing, shadows, radii, motion, typography, components)
- `ui_kits/new-store-folder/` — Full React UI kit for the "new store" onboarding flow
- `ui_kits/workspace/` — Workspace shell components (Chrome, Command, Surfaces, Primitives)
- `assets/` — SVG brand assets (logo marks, wordmarks, favicon)

---

## 10. Security Findings

### 🔴 CRITICAL

#### SEC-01: `ALLOW_ANON_DEMO_USER` must be `false` in all deployed environments

```python
# app/core/deps.py
if settings.allow_anon_demo_user:
    return _DEMO_USER   # role: "executive" — no auth required
```

**Risk:** If this env var is accidentally set to `true` in production (Railway/Render/Fly.io), every unauthenticated HTTP request gets `executive` role access to the entire API — no credentials needed.  
**Fix:** Add a startup validator in `Settings._refuse_insecure_production_config` that raises `RuntimeError` if `allow_anon_demo_user=true` and `environment != "local"`.

---

#### SEC-02: `require_scope()` raises `NotImplementedError` — live on routers

```python
# app/rbac/guards.py
def require_scope(kind: str) -> Callable:
    raise NotImplementedError(...)
```

**Risk:** Any router that calls `Depends(require_scope(...))` will crash with a 500 at runtime. If it's referenced in any active endpoint, it's a denial-of-service vector against authenticated users.  
**Fix:** Audit all routers for `require_scope` usage. Remove calls or implement before going live.

---

### 🟠 HIGH

#### SEC-03: JWT refresh grace window is 7 days

```python
REFRESH_GRACE_SECONDS = 60 * 60 * 24 * 7  # 7 days
```

**Risk:** A stolen token that expired up to 7 days ago can still mint a fresh session if the attacker hits `POST /auth/refresh`. The `is_active` check mitigates this for deactivated accounts but not for active ones.  
**Fix:** Reduce to 24–48 hours maximum. Consider storing a `refresh_token_id` in the DB and revoking it on logout.

---

#### SEC-04: File MIME type validated by client-declared `Content-Type` header, not magic bytes

```python
# app/core/uploads.py
content_type = getattr(file, "content_type", None)
if content_type and content_type not in ALLOWED_MIME:
    raise _unsupported(content_type)
```

**Risk:** An attacker can upload a malicious file (e.g., an HTML file with XSS, or an executable) with a spoofed `Content-Type: application/pdf`. The MIME type is not verified against the actual file bytes (magic numbers).  
**Fix:** Use `python-magic` or `filetype` to verify the first 512 bytes of every upload against the declared MIME type. Reject mismatches with 415.

---

#### SEC-05: `X-Forwarded-For` header used for rate-limit key — spoofable without proxy trust configuration

```python
# app/core/ratelimit.py
fwd = request.headers.get("x-forwarded-for")
if fwd:
    return fwd.split(",")[0].strip()
```

**Risk:** If the backend is ever accessible without going through Railway's proxy (e.g., direct IP), an attacker can set an arbitrary `X-Forwarded-For` header to bypass the rate limiter entirely.  
**Fix:** Configure Railway's trusted proxy IPs in FastAPI's `ProxyHeadersMiddleware` (`app = FastAPI(); app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")`) so only the real proxy-set header is trusted.

---

#### SEC-06: In-process rate limiter is not distributed

```python
# In-memory dict — lost on restart, not shared across processes
_WINDOWS: Dict[Tuple[str, str], Deque[float]] = defaultdict(deque)
```

**Risk:** Any horizontal scaling (multiple Railway replicas, process restart after crash) resets all rate-limit counters. An attacker can reset limits by triggering a restart, or by hitting different instances.  
**Fix (now):** Document the single-instance constraint clearly in deployment runbook.  
**Fix (later):** Replace `_WINDOWS` store with a Redis-backed sliding window when scaling.

---

### 🟡 MEDIUM

#### SEC-07: Platform admin password stored in environment variable, no rotation mechanism

**Risk:** The platform admin password (`PLATFORM_ADMIN_PASSWORD`) is a static secret in the hosting environment. If leaked (e.g., through a logs exposure or env dump), there's no way to audit its use or rotate it without redeployment.  
**Fix:** Add audit logging to every admin portal request. Add a `/admin/rotate-token` endpoint that generates a time-limited token from the master password.

---

#### SEC-08: Token stored in `localStorage` (persists across browser sessions)

**Risk:** `localStorage` is accessible to any JavaScript on the page. A successful XSS attack would extract the auth token trivially. `localStorage` also persists after the browser is closed, unlike `sessionStorage`.  
**Fix:** Store the token in `sessionStorage` (cleared on tab close) or a `httpOnly` cookie (not accessible to JS at all). If keeping localStorage, implement a short token TTL and ensure CSP headers are set.

---

#### SEC-09: No Content-Security-Policy headers set

**Risk:** No CSP headers were found in the FastAPI `main.py` middleware stack or Vercel config. This leaves the frontend vulnerable to XSS injection loading arbitrary scripts.  
**Fix:** Add `SecurityHeadersMiddleware` to FastAPI. For Vercel, add CSP headers in `vercel.json`.

---

#### SEC-10: `image/svg+xml` explicitly excluded from upload allowlist (good), but `text/csv` is allowed

**Risk:** While SVG is correctly blocked (it can contain `<script>`), CSV files can contain formula injection (`=CMD(...)` in Excel). If CSV files are ever opened in spreadsheet software or rendered in a table, this is a vector.  
**Fix:** If CSVs are only used for data export and not user-supplied uploads, remove from the allowlist. If user-uploaded CSVs are required, sanitize cells starting with `=`, `+`, `-`, `@` before storing.

---

### 🟢 GOOD SECURITY PRACTICES OBSERVED

- ✅ JWT secret placeholder detection at startup — refuses to boot with public default key
- ✅ Wildcard CORS origin auto-stripped with warning in config validator
- ✅ Retired admin password detected and portal disabled (not a boot failure)
- ✅ `is_active` re-read from DB on every request (immediate account kill switch)
- ✅ File upload size cap with streaming enforcement (prevents OOM)
- ✅ `require` claims validation (`exp`, `sub`) on JWT decode
- ✅ Audience validation on JWT decode
- ✅ MIME type allowlist for uploads (excludes SVG, ZIP)
- ✅ Rate limiting on unauthenticated endpoints (login, refresh, workspace-code lookup)
- ✅ `REFRESH_GRACE_SECONDS` grace check — dead tokens can't be refreshed forever
- ✅ Bandit + Ruff `S` rules in CI linting pipeline
- ✅ Tenant isolation enforced via `tenant_id` in all queries

---

## 11. Code Quality & Bugs

### BUG-01: Transaction savepoint regression (FIXED in #103)

**Location:** `app/core/deps.py` → `get_current_user`  
**Description:** The `is_active` DB read opened an implicit SQLAlchemy transaction. Subsequent writes inside `transaction()` would open a SAVEPOINT (not a real transaction), causing all writes to silently roll back on session close.  
**Status:** ✅ Fixed — `await db.rollback()` added after the read-only check.

---

### BUG-02: `require_scope()` is a stub that raises `NotImplementedError`

**Location:** `app/rbac/guards.py:42`  
**Risk:** Runtime 500 if any route uses it. See SEC-02.

---

### CODE-01: `TODO(db)` comment in frontend API client

```javascript
// TODO(db): set BASE_URL from env once backend is deployed.
const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';
```

**Location:** `frontend/src/services/api/client.js`  
**Status:** The env var is read correctly (`import.meta.env.VITE_API_BASE_URL`). The TODO is stale — remove it.

---

### CODE-02: Payments module is a terminal stub

```python
SiteStatus.PUSHED_TO_PAYMENTS: [],  # terminal
```

Sites reaching `PUSHED_TO_PAYMENTS` have no further workflow. The Payments module is not yet built.

---

### CODE-03: `useFocusSite` uses polling with up to 30 attempts × 200ms = 6 seconds

```javascript
} else if (++attempts < 30) {
    setTimeout(tick, 200);
}
```

**Risk:** On slow connections, the site row may still not be rendered after 6 seconds and the scroll silently fails.  
**Fix:** Use a `MutationObserver` on the list container instead of polling.

---

### CODE-04: Error thrown as `new Error(...)` in `apiFetch` loses HTTP status code

```javascript
throw new Error(`API ${method} ${path} failed: ${res.status} ${detail}`);
```

**Risk:** Callers can't distinguish 401 (redirect to login), 403 (permission denied), 429 (rate limited), or 5xx (server error) — all arrive as generic `Error` objects. The status is embedded in a string.  
**Fix:** Create an `ApiError` class with `status`, `detail`, and `path` fields. Update all catch blocks accordingly.

---

### CODE-05: `_DEMO_USER` has a hardcoded fake UUID tenant

```python
"tenant_id": "00000000-0000-0000-0000-000000000099",
```

If demo mode is ever enabled with a real DB, queries scoped to this fake tenant UUID will silently return empty results rather than failing, making the demo misleadingly appear to work.

---

## 12. Test Coverage

### Backend tests (`backend/tests/`)

| Test file | What it covers |
|---|---|
| `test_nso_stage_three_gate.py` | NSO stage 3 gate transitions |
| `test_project_excellence_shared_budget.py` | Budget sharing across project excellence module |
| `test_project_init_and_budget.py` | Project initialization and budget allocation |
| `test_write_persistence_regression.py` | Regression test for the savepoint/transaction bug (#103) |
| `test_batch_a_observability.py` | Observability / audit log assertions |

**Total backend Python:** ~22,990 lines  
**Estimated test coverage:** Moderate — core domain logic and known regressions are tested; auth, RBAC guard behavior, and file upload paths appear untested.

### Frontend tests (`frontend/src/`)

| Test file | What it covers |
|---|---|
| `state/__tests__/sessionHydrate.test.js` | SessionContext hydration from stored token |
| `test/smoke.test.jsx` | App renders without crashing |

**Coverage gaps:**
- No tests for `apiFetch` error handling
- No tests for `useSiteDataRefresh` event subscriptions
- No tests for state machine transitions on the frontend side
- No E2E tests (Playwright/Cypress)

---

## 13. Pending / Incomplete Work

From `left_out_tasks.md`:

| # | Task | Status |
|---|---|---|
| 1 | Share `.env` files with teammate via secure channel (1Password/Signal) | ⬜ Pending |
| 2 | Supabase auth user needs `app_metadata` set (role, tenant_id, city) | ⬜ Pending |
| 3 | `public.users` row must be INSERTed for auth user (FK constraint) | ⬜ Pending |
| 4 | Frontend → Vercel deployment | ⬜ Pending |
| 5 | Backend → Railway / Render / Fly.io deployment | ⬜ Pending |
| 6 | Set `VITE_API_BASE_URL` in Vercel env vars | ⬜ Pending |
| 7 | Payments module (currently a terminal state stub) | 🚧 Not built |
| 8 | `require_scope()` RBAC guard | 🚧 Not implemented |
| 9 | Distributed rate limiter (Redis) for horizontal scale | 🚧 Deferred |

---

## 14. Dependency Risks

### Backend

| Package | Risk |
|---|---|
| `PyJWT` | Pin to latest — JWT libraries have had critical CVEs. Verify `>=2.8.0`. |
| `SQLAlchemy 2.0` | Async session behavior changed significantly from 1.x; ensure no legacy patterns remain. |
| `pydantic-settings v2` | Breaking change from v1 — confirm all `Settings` fields use new `model_validator` syntax. ✅ Already done. |
| `supabase-py` / `gotrue` | Not imported in backend (correct — backend validates JWTs itself, does not use SDK). ✅ Good. |

### Frontend

| Package | Risk |
|---|---|
| `axios` | Used only for auth flow; `apiFetch` (plain `fetch`) used elsewhere. Mixed HTTP clients → inconsistent error handling. Standardise on one. |
| `supabase-js` | Comment in `supabaseAuth.js` says SDK is deliberately not used anymore. Verify it is not in `package.json` — if so, remove to reduce bundle size. |
| No lockfile pinning for backend | `pyproject.toml` has no pinned versions in `[project.dependencies]`. A `requirements.txt` or `uv.lock` should pin all transitive deps for reproducible builds. |

---

## 15. Recommendations Summary

### Immediate (before production deploy)

| Priority | Action |
|---|---|
| 🔴 | Add startup guard: refuse boot if `ALLOW_ANON_DEMO_USER=true` and `ENV != local` |
| 🔴 | Audit all routers for `require_scope()` usage — remove or implement |
| 🟠 | Reduce JWT refresh grace from 7 days → 24–48 hours |
| 🟠 | Validate upload MIME types against file magic bytes, not just Content-Type header |
| 🟠 | Configure `ProxyHeadersMiddleware` with trusted proxy IPs for correct rate-limit keying |
| 🟡 | Add CSP headers to FastAPI middleware and `vercel.json` |
| 🟡 | Move auth token from `localStorage` → `sessionStorage` or `httpOnly` cookie |
| 🟡 | Replace `apiFetch` generic `Error` with typed `ApiError` class |

### Short term (first sprint after launch)

| Priority | Action |
|---|---|
| 🟠 | Build Payments module (unblock `PUSHED_TO_PAYMENTS` terminal state) |
| 🟡 | Replace `useFocusSite` polling with `MutationObserver` |
| 🟡 | Add audit logging to platform admin portal requests |
| 🟡 | Pin all backend Python dependencies in a lockfile |
| 🟡 | Remove stale `TODO(db)` comment in `client.js` |
| 🟢 | Add `ApiError` unit tests in frontend |
| 🟢 | Add auth guard unit tests (valid token, expired token, missing role claim) |
| 🟢 | Add upload MIME spoofing test in backend test suite |

### Long term

| Priority | Action |
|---|---|
| 🟡 | Replace in-process rate limiter with Redis-backed sliding window |
| 🟡 | Add E2E tests (Playwright) for the full site creation → legal approval workflow |
| 🟡 | Implement token revocation list (Redis) to support instant logout across devices |
| 🟢 | Standardise frontend HTTP client — remove `axios` or remove custom `apiFetch`, pick one |

---

*This document was generated from a static analysis of the repository on 2026-06-16. It does not replace a full professional security audit. All findings should be triaged by the team before acting on them.*
