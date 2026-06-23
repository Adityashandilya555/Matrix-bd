# Matrix developer guide

This documentation explains the codebase in the order a new developer needs it. Read the first eight pages in sequence; use the remaining pages while changing or running the system.

| Order | Page | Question answered |
| --- | --- | --- |
| 1 | [Project overview](00-overview/project-overview.md) | What does Matrix do and which technologies matter? |
| 2 | [System architecture](01-architecture/system-architecture.md) | Which layer owns each responsibility? |
| 3 | [Data model](02-data-model/data-model.md) | Where is data stored and related? |
| 4 | [Site lifecycle](03-state-machine/site-lifecycle.md) | Which site transitions are legal? |
| 5 | [Frontend state](04-frontend-state/frontend-state.md) | What is global, local, stored, or derived? |
| 6 | [API layer](05-api-contracts/api-layer.md) | How does the browser call the backend? |
| 7 | [Transaction flows](06-db-transactions/transaction-flows.md) | What happens after a user clicks an action? |
| 8 | [Request lifecycle](11-request-lifecycle/request-lifecycle-deep-dive.md) | How do the adapter, FastAPI, dependencies, and services fit together? |
| 9 | [Authentication and RBAC](07-auth-rbac/authentication-and-authorization.md) | How are identity, role, module, tenant, and ownership enforced? |
| 10 | [Developer setup](08-running-locally/developer-setup.md) | How do I run the application? |
| 11 | [Testing and errors](09-testing/testing-and-errors.md) | How is correctness checked and how do failures surface? |
| 12 | [Change rules](10-change-management/change-rules.md) | Which files must change together? |

## Documentation rule

Every section contains a **Source of Truth** block. A statement that cannot be traced to code, configuration, schema, migration, or tests does not belong here. Line ranges are navigation aids; use the named symbol when normal edits shift a range.

> **Source of Truth**
> - `backend/database/verified.sql:1-3` — defines the SQL file as a context-only schema reference, not an executable bootstrap.
> - `backend/app/db/models.py:1-33` — runtime ORM mappings.
> - `backend/database/migrations/` — ordered database change history.
> - `backend/app/` and `frontend/src/` — runtime behavior.
