# Runbooks

Operational specs and the "why" behind systems whose runtime behavior isn't obvious from the code alone. Distinct from `docs/api/` (route reference) and `Matrix_dev/` (architecture vault).

| file                              | covers                                                                |
| --------------------------------- | --------------------------------------------------------------------- |
| `notification-outbox-worker.md`   | Email/Slack dispatch loop spec, queue health queries, deployment plan |
| `role-canonicalization.md`        | `executive` vs `exec` rules, sub-supervisor scoping, delegation model |
