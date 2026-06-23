# Frontend state management

The frontend uses React Context for cross-route state and ordinary component state for page-local interaction. It does not use Redux or a client cache library.

## Provider tree

```text
HashRouter
└── SessionProvider
    └── SitesProvider
        └── AppRouter
```

`SitesProvider` depends on the hydrated session, so provider order is significant.

> **Source of Truth**
> - `frontend/src/main.jsx:13-22` — provider order.

## SessionContext

`SessionContext` owns:

- hydrated user, role, tenant, city, module, and `authReady`;
- token-change-driven `/auth/whoami` hydration;
- session-expiry UI behavior;
- role-derived permissions;
- dark-mode preference.

The token itself is not React state. `authToken.js` keeps it in a module closure mirrored to `sessionStorage`, then notifies subscribers. In HTTP mode the role switcher is disabled because the backend-issued role is authoritative.

> **Source of Truth**
> - `frontend/src/state/SessionContext.jsx:40-75,92-180,182-216` — session lifecycle and derived value.
> - `frontend/src/services/api/authToken.js:15-60` — token storage and subscriptions.

## SitesContext

`SitesContext` stores one canonical `sites` array. Components never mutate it directly. Actions call `siteService`, await the backend/mock result, then refetch the entire list.

Derived selectors expose legacy page shapes:

| Selector | Canonical statuses |
| --- | --- |
| `drafts` | `draft_submitted` |
| `shortlist` | `shortlisted`, `details_submitted` |
| `staging` | `approved`, `loi_uploaded`, legal states, `pushed_to_payments` |
| `archive` | `archived`, `rejected`, `legal_rejected` |

This compatibility layer is why old page components can read `stage`, `inReview`, `loiUploaded`, and `pushed` without those fields being database columns.

> **Source of Truth**
> - `frontend/src/state/SitesContext.jsx:20-41,146-175` — canonical store and load gate.
> - `frontend/src/state/SitesContext.jsx:220-252` — selectors.
> - `frontend/src/state/SitesContext.jsx:254-354` — mutation API.

## Refresh model

The site list refreshes:

- after each mutation;
- when identity, role, or auth readiness changes;
- on a cross-module `matrix:sites-changed` browser event;
- when the tab regains focus or visibility;
- every 30 seconds while authenticated.

Module pages can use `useSiteDataRefresh` to filter refreshes by source, action, and site and to coalesce focus/visibility bursts.

> **Source of Truth**
> - `frontend/src/state/SitesContext.jsx:153-218` — global refresh triggers.
> - `frontend/src/services/api/siteEvents.js:1-13` — event bus.
> - `frontend/src/hooks/useSiteDataRefresh.js:4-62` — scoped refresh hook.

## Local state

Forms, modals, open drawers, toasts, filters, pagination, and loading flags belong to their page/component unless multiple unrelated routes require them. `App.jsx` keeps only shell-level UI state, including the site drawer and “new pipeline” modal.

> **Source of Truth**
> - `frontend/src/App.jsx:22-41,61-86,193-224` — shell-local state.
> - `frontend/src/modules/landing/BrandedLoginPage.jsx:47-146` — page-local multi-step form state.

## Data normalization boundary

Frontend code uses camelCase canonical objects. The HTTP adapter converts snake_case responses and computes presentation helpers. The mock adapter returns the same canonical shape. Service and context code therefore do not branch on transport.

> **Source of Truth**
> - `frontend/src/services/api/adapters/index.js:1-14` — transport selection.
> - `frontend/src/services/api/adapters/httpAdapter.js:165-321` — request/response normalization.
> - `frontend/src/services/api/siteService.js:1-20` — public service boundary.
