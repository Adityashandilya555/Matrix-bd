# Admin role simulation

Business admins can enter the main workspace while simulating a specific role (Supervisor or Executive) and module (BD, Legal, Design, Project Excellence, Project, NSO). This lets them observe exactly what a team member sees without needing a separate account.

The feature is introduced in the workspace-switcher PR (`feat/business-admin-role-switcher`). This page documents its design so that changes to auth, RBAC, or the business admin portal stay consistent with the simulation contract.

## Design goals

- A business admin who activates simulation must appear to every downstream consumer — route guards, API calls, UI components — as the simulated role/module.
- Navigating between the `/business-admin` portal and the main workspace (`/`) must preserve the simulation; the two portals are separate React trees loaded in the same tab.
- Exiting the simulation must be instant and require no page reload.
- The backend must not trust the simulation headers from non-admin tokens.

## sessionStorage persistence

The simulation override is stored under the key `zm:admin-override` in `sessionStorage` (not `localStorage`). This means:

- It survives same-tab navigation between `/business-admin` and `/`.
- It is cleared automatically when the tab closes.
- It is isolated to the tab — two admin tabs can simulate different roles.

> **Source of Truth**
> - `frontend/src/services/api/adminOverride.js:5` — `STORAGE_KEY = 'zm:admin-override'`.

## `adminOverride.js` singleton

All override state is managed by a plain-module singleton, not React. This is deliberate: the axios request interceptor runs outside the React tree and needs synchronous access to the current override without subscribing to context.

```text
activateOverride({ role, module })
    │
    ├── writes to _active (module-level variable)
    └── writes to sessionStorage['zm:admin-override']

deactivateOverride()
    │
    ├── clears _active
    └── removes sessionStorage key

getActiveOverride()  ← called by axios interceptor on every request
    └── returns _active (never reads sessionStorage; avoids I/O per request)

getStoredOverride()  ← called once at module load and in SessionContext hydration
    └── reads and parses sessionStorage
```

> **Source of Truth**
> - `frontend/src/services/api/adminOverride.js` — full singleton implementation.

## Axios header injection

`axiosClient.js` reads `getActiveOverride()` in its request interceptor and injects two headers when an override is active:

| Header | Value |
| --- | --- |
| `X-Override-Role` | `supervisor` or `executive` |
| `X-Override-Module` | `bd`, `legal`, `design`, `project_excellence`, `project`, or `nso` |

These headers are injected only for requests from a business admin. The backend validates this (see backend section below).

> **Source of Truth**
> - `frontend/src/services/api/axiosClient.js` — request interceptor, override header injection.

## SessionContext additions

`SessionContext` is the single source of truth for the effective role seen by all main-workspace consumers. Three new values are added:

| Value | Type | Description |
| --- | --- | --- |
| `isBusinessAdmin` | `boolean` | True when the real JWT role is `business_admin`. |
| `effectiveModule` | `string \| null` | The simulated module when active; otherwise `session.module`. |
| `adminOverride` | `{ role, module } \| null` | Raw override object; null when no simulation is running. |
| `switchAs(role, module)` | function | Activates or clears the override; no-op for non-admin users. |

The `role` value returned by `useSession()` is derived:

```text
isBusinessAdmin && adminOverride?.role
    ? adminOverride.role          ← simulated role, e.g. 'supervisor'
    : session.role                ← real JWT role, e.g. 'business_admin'
```

This means:

- `AppRouter` at line 90 checks `role === 'business_admin'` to redirect admins to their portal. When a simulation is active, `role` resolves to `'supervisor'` or `'executive'`, so the redirect does not fire and the admin stays in the main workspace.
- All downstream components that read `role` from `useSession()` — route guards, sidebar items, "New pipeline" button gating — see the simulated role with no additional changes.

Clearing the token on sign-out also calls `deactivateOverride()` so stale override data never persists across sessions.

> **Source of Truth**
> - `frontend/src/state/SessionContext.jsx` — `adminOverride` state, `isBusinessAdmin`, `effectiveModule`, `switchAs`, derived `role`.

## WorkspaceSwitcherPanel

The "Workspace Access" tab in `TeamDashboard` renders `WorkspaceSwitcherPanel`. It shows:

- Two dropdowns: Role (Supervisor / Executive) and Module (BD / Legal / Design / Project Excellence / Project / NSO).
- An "Enter Workspace →" button that calls `activateOverride({ role, module })` then navigates to the module's home route via `window.location.href`.
- An active simulation badge if `getStoredOverride()` is non-null, with an Exit button that calls `deactivateOverride()`.

Navigation uses `window.location.href` (not React Router) because the target route is in the main workspace, a separate React tree.

> **Source of Truth**
> - `frontend/src/modules/business-admin/WorkspaceSwitcherPanel.jsx` — panel implementation.
> - `frontend/src/modules/business-admin/TeamDashboard.jsx:80` — workspace tab registration.

## Floating simulation badge

When the main workspace is active and an override is running, `App.jsx` renders a fixed-position badge showing the simulated role and module. An Exit button calls `switchAs(null, null)` and navigates back to `/business-admin`.

> **Source of Truth**
> - `frontend/src/App.jsx` — `isBusinessAdmin && adminOverride` badge rendering.

## Backend enforcement

The backend bypasses role and module guards for `business_admin` JWT tokens:

```python
# In require_role guard:
if user_role == Role.BUSINESS_ADMIN.value:
    return current_user   # bypass; BA can call any role-gated route

# In require_module guard:
if user_role == Role.BUSINESS_ADMIN.value:
    return current_user   # bypass; BA can call any module-gated route
```

The `X-Override-Role` and `X-Override-Module` headers are informational for logging; the backend does not use them for access decisions. The bypass is based solely on the verified JWT role claim.

Non-admin tokens that include `X-Override-Role` or `X-Override-Module` headers are unaffected: the header is ignored and normal guards apply.

> **Source of Truth**
> - `backend/app/rbac/guards.py:20-24,54-56` — `BUSINESS_ADMIN` bypass in `require_role` and `require_module`.

## Simulation flow end-to-end

```mermaid
sequenceDiagram
  participant BA as Business admin (portal)
  participant WS as WorkspaceSwitcherPanel
  participant AO as adminOverride.js
  participant SS as sessionStorage
  participant SC as SessionContext (main workspace)
  participant AX as axiosClient.js
  participant API as FastAPI guards

  BA->>WS: selects Supervisor + BD, clicks Enter Workspace
  WS->>AO: activateOverride({role:'supervisor', module:'bd'})
  AO->>SS: write zm:admin-override
  WS->>WS: window.location.href = '/'
  Note over SC: main workspace mounts; SessionContext hydrates
  SC->>AO: getStoredOverride() → {role:'supervisor', module:'bd'}
  SC->>SC: adminOverride = {role:'supervisor', module:'bd'}
  SC->>SC: role = 'supervisor' (overrides 'business_admin')
  BA->>API: any request via axiosClient
  AX->>AO: getActiveOverride()
  AX->>API: X-Override-Role: supervisor, X-Override-Module: bd
  API->>API: JWT role = 'business_admin' → bypass guards
  API-->>AX: 200 OK
  BA->>BA: clicks Exit badge
  SC->>AO: switchAs(null, null) → deactivateOverride()
  AO->>SS: remove zm:admin-override
  SC->>SC: adminOverride = null, role = 'business_admin'
  SC->>SC: AppRouter fires → Navigate to /business-admin
```

## What this does not simulate

- **Object ownership**: the backend's executive scope check restricts list results to sites owned by, assigned to, or delegated to the actor. A business admin in simulation mode is not listed as owner/assignee of any site, so executive-scoped lists will be empty. This is expected behavior and is not a bug.
- **Module membership**: the JWT contains no `module` claim for business admins. The override injects a module via the header but does not create a `user_module_memberships` row. Routes that read the `module` claim from the JWT (rather than the header) will still see no module.
- **City scope**: city is not part of the override; the simulated session has no city restriction.
