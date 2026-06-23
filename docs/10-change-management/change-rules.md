# Change management rules

Use these rules to keep duplicated contracts synchronized.

## Changing the site lifecycle

Update together:

1. Backend enum and transition graph.
2. Every service handler and role gate for the new edge.
3. Database check constraint through a new migration.
4. Frontend state-machine mirror and legacy mapping.
5. `SitesContext` selectors if queue membership changes.
6. Mock adapter behavior.
7. Backend/frontend parity and invalid-transition tests.
8. This documentation.

> **Source of Truth**
> - `backend/app/domain/state_machine.py:11-58`.
> - `backend/app/routers/sites.py:167-250`.
> - `frontend/src/lib/stateMachine.js:1-83`.
> - `frontend/src/state/SitesContext.jsx:220-252`.

## Changing an API contract

Update in this order:

1. Pydantic request/response model.
2. Router signature and response model.
3. Service behavior.
4. HTTP adapter snake/camel conversion.
5. Mock adapter with the same canonical return shape.
6. Public frontend service.
7. Contract/mapping tests and this documentation.

Do not make page components aware of snake_case wire fields.

> **Source of Truth**
> - `backend/app/domain/schemas/site.py:51-247`.
> - `frontend/src/services/api/adapters/httpAdapter.js:165-365`.
> - `frontend/src/services/api/siteService.js:1-20`.

## Changing the database

1. Add a new ordered migration; never edit history that may already be applied.
2. Make additive changes first.
3. Update ORM models.
4. Update services and Pydantic responses.
5. Refresh `schema.sql` as a readable snapshot after the live schema is confirmed.
6. Keep destructive cleanup separate and explicitly authorized.
7. Test both upgraded data and fresh expected constraints.

`schema.sql` is documentation, not the migration mechanism.

> **Source of Truth**
> - `backend/database/schema.sql:1-9`.
> - `backend/database/migrations/202606144_shared_site_budgets.sql:1-13` — additive migration pattern.
> - `backend/database/migrations/202606145_drop_legacy_project_budget.sql:1-9` — isolated destructive pattern.

## Changing auth or RBAC

Check all layers:

- JWT claims and refresh behavior;
- current-account DB recheck;
- backend role/module dependencies;
- tenant and object scope in services;
- frontend route guards and home routing;
- permissions maps only where UI visibility uses them;
- mock mode differences;
- authz regression tests.

Never rely on a hidden button or route redirect as authorization.

> **Source of Truth**
> - `backend/app/core/security.py:40-193`.
> - `backend/app/core/deps.py:32-89`.
> - `backend/app/rbac/guards.py:8-57`.
> - `frontend/src/router/guards.jsx:18-59`.

## Changing shared state

Before adding context state, ask:

1. Is the database/API the real source of truth?
2. Can the value be derived from canonical sites/session?
3. Is it needed across unrelated routes?
4. What invalidates or refreshes it?

Prefer local state for page interaction, derived selectors for presentation, and context only for cross-route state.

> **Source of Truth**
> - `frontend/src/state/SitesContext.jsx:20-41,146-218`.
> - `frontend/src/state/SessionContext.jsx:40-75,195-216`.

## Pull-request checklist

- [ ] Every behavior claim has a source reference.
- [ ] Migrations, ORM, schemas, adapters, and mocks agree.
- [ ] Tenant and object scope are preserved.
- [ ] Audit/outbox writes share the intended transaction.
- [ ] Slow network/storage work does not hold a DB transaction.
- [ ] Backend tests, frontend lint/build/tests, and smoke checks pass.
- [ ] Any known source drift is stated, not hidden.
- [ ] Documentation changed with the contract.
