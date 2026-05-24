# Role Canonicalization

## The canonical names

Three tenant roles, plus one system role. These are the only valid values in `users.role` and in JWT `role` claims:

| canonical value   | who                                                                |
| ----------------- | ------------------------------------------------------------------ |
| `executive`       | BD exec — sources sites, drafts pipeline, fills shortlist details  |
| `supervisor`      | Workspace owner — approves, archives, manages team, delegates      |
| `sub_supervisor`  | City-scoped supervisor — can act on sites in `assigned_city` only  |
| `system`          | Reserved for internal-only routes (e.g. `/notifications/send`)     |

Source of truth:

- Backend: `backend/app/rbac/roles.py` (`Role` enum)
- Frontend: `frontend/src/rbac/roles.js` (`ROLE` const)

Both files cross-reference each other in their leading comment. **If you add or rename a role, update both in the same PR.**

## The `exec` legacy alias

For historical UI reasons, many React components compare against the string `'exec'`, not `'executive'`. To avoid a sweeping rename, the frontend exposes:

```js
import { ROLE_DISPLAY, canonicalRole } from 'src/rbac/roles.js';

ROLE_DISPLAY[ROLE.EXECUTIVE]  // → 'exec'
canonicalRole('exec')         // → 'executive'
```

Rules:

1. **Anything that touches the wire (HTTP, JWT, DB) uses `'executive'`.** No exceptions — the backend will reject `'exec'`.
2. **Anything inside React component prop comparisons may keep `'exec'`** until we do a deliberate sweep. New code should still prefer the canonical value where possible.
3. **Always pass tokens through `canonicalRole()`** at the boundary between the network response and React state (currently in `SessionContext`).

## Where the mismatch can bite you

- `SessionContext.role` exposes the **display** value (`'exec'`) for component compatibility — old components break otherwise.
- JWT claims and the `/auth/whoami` payload return the **canonical** value (`'executive'`).
- `RequireRole` in `frontend/src/router/guards.jsx` accepts arrays of canonical values — pass `['executive']`, not `['exec']`.
- RBAC checks in `frontend/src/rbac/permissions.js` are keyed by canonical role.

If a route guard ever rejects a logged-in exec, the cause is almost always `RequireRole roles={['exec']}` instead of `['executive']`. Search and convert.

## Sub-supervisor scoping

Sub-supervisors are city-scoped by default — `users.assigned_city` is the only city they can act in. Two escapes:

1. **Delegations** (`site_delegations` table) — a supervisor grants a sub-supervisor permission for a specific site. Lives independently of city scope. See `backend/app/services/delegation_service.py`.
2. **Mine vs Team toggle** — on the Pipeline view, sub-supervisors see a segmented control (mine / team / all) so they can switch between their own drafts and the wider team's. RBAC still applies to the decision buttons; the toggle only changes the visible set.

The frontend `RequireRole` guards never list `sub_supervisor` without also listing `supervisor` — sub-sup is a strict subset of supervisor's read access, never a peer.

---

Last updated: 2026-05-24
