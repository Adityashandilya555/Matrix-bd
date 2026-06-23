# Domain state machine

The BD site lifecycle is shared between backend and frontend. The backend is authoritative; the frontend mirror prevents impossible UI actions and preserves legacy page labels.

## Canonical states and transitions

| From | Allowed next states | Main actor |
| --- | --- | --- |
| `draft_submitted` | `shortlisted`, `rejected`, `archived` | Supervisor |
| `shortlisted` | `details_submitted`, `rejected`, `archived` | Executive submits; supervisor rejects/archives |
| `details_submitted` | `approved`, `rejected`, `archived` | Supervisor |
| `approved` | `loi_uploaded`, `rejected`, `archived` | Owning/assigned executive uploads LOI |
| `loi_uploaded` | `legal_review`, `rejected`, `archived` | Supervisor |
| `legal_review` | `legal_approved`, `legal_rejected` | Legal workflow |
| `legal_approved` | `pushed_to_payments` | Legal/payment handoff |
| `legal_rejected` | `legal_review` | Approved change-request recovery |
| `pushed_to_payments` | none | Terminal in this FSM |
| `rejected` | none | Terminal |
| `archived` | none in generic FSM | Supervisor-only revive uses saved prior status |

> **Source of Truth**
> - `backend/app/domain/state_machine.py:11-45` — canonical enum and graph.
> - `frontend/src/lib/stateMachine.js:5-34` — required mirror.
> - `backend/app/services/bd_service.py:520-564` — explicit archive revival outside the generic graph.

```mermaid
stateDiagram-v2
  [*] --> draft_submitted
  draft_submitted --> shortlisted
  shortlisted --> details_submitted
  details_submitted --> approved
  approved --> loi_uploaded
  loi_uploaded --> legal_review
  legal_review --> legal_approved
  legal_review --> legal_rejected
  legal_rejected --> legal_review
  legal_approved --> pushed_to_payments
  draft_submitted --> rejected
  shortlisted --> rejected
  details_submitted --> rejected
  approved --> rejected
  loi_uploaded --> rejected
  draft_submitted --> archived
  shortlisted --> archived
  details_submitted --> archived
  approved --> archived
  loi_uploaded --> archived
```

## Enforcement

Backend services lock the site row, convert the current string to `SiteStatus`, call `assert_transition`, then mutate. Invalid transitions return HTTP `422`. The universal status endpoint also blocks supervisor-only target states before entering a service.

Mock mode calls the frontend `assertTransition` and throws an `Error`. HTTP mode does not trust the frontend mirror; the backend revalidates.

> **Source of Truth**
> - `backend/app/domain/state_machine.py:48-58` — backend `422`.
> - `backend/app/routers/sites.py:167-250` — status dispatcher and role gates.
> - `backend/app/services/bd_service.py:178-210,274-333,338-391` — locked transition examples.
> - `frontend/src/lib/stateMachine.js:36-45` and `frontend/src/services/api/adapters/mockAdapter.js:87-128` — mock enforcement.

## Important exceptions

- A supervisor-created site starts directly as `shortlisted`; it does not approve its own draft.
- Archive revival restores `archived_from_status`; it is not a normal `archived -> X` graph edge.
- “Push to payments” is a compatibility name. The current BD action sends `loi_uploaded -> legal_review`.
- Module workflows such as Design, Project, NSO, Launch, finance, and shared budgets have their own status fields and service rules; they do not extend `SiteStatus`.

> **Source of Truth**
> - `backend/app/services/bd_service.py:107-173` — supervisor auto-shortlist.
> - `frontend/src/services/api/siteService.js:86-90` — compatibility wrapper.
> - `backend/app/services/bd_service.py:394-447` — actual legal handoff.
> - `backend/app/db/models.py:125-165,749-814,821-902,939-1002` — module status fields.
