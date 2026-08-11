# How approval-flow changes work — step by step

**Companion to:** [`Palantir_Evaluation.md`](./Palantir_Evaluation.md) · [`Build_Sequence.md`](./Build_Sequence.md)
**Interactive versions:** [`designer.html`](./designer.html) (arrange the flow) · [`console.html`](./console.html) (run the kernel)
**Verified against the code:** 2026-08-11

This document answers one question: *what actually has to change so that reordering approvals, adding approval levels, choosing approvers, and adding fields become configuration instead of code?*

It starts from your app as it is today and moves one step at a time. Each step says what changes, why, and what it costs.

---

## The three things people mean by "change the approval flow"

They get conflated constantly, including by me in an earlier explanation. They are separate mechanisms with separate storage:

| # | What it means | Mechanism |
|---|---|---|
| 1 | **Order** — Design comes before Finance | Edges between modules |
| 2 | **Levels** — this needs two sign-offs, not one | A chain of steps inside one module |
| 3 | **Assignees** — level 2 goes to the module supervisor | A resolution rule per step |

A fourth, related question — *"can a client add or rename a field?"* — is a different mechanism again, covered in Step 4.

---

## Step 0 — Where you are today

Ground truth, checked against the repo.

### Order is Python, stated twice

```python
# backend/app/services/workflow_unlocks.py:25
def design_unlock_ready(site: models.Site) -> bool:
    return (site.legal_dd_status or "pending") == "positive" and (
        site.finance_status or "pending") == "approved"

# backend/app/services/design_service.py:230
def _assert_design_unlocked(site: models.Site) -> None:
    ...  # the same rule again, raising 422 with per-branch messages
```

`_assert_design_unlocked` is then called from **four** places — `design_service.py:341, 452, 923, 983`. So one business rule lives in two definitions and five call sites. Changing the order means editing both definitions consistently, and the frontend's `stateMachine.js` mirrors the transition table by hand on top of that.

### Levels are frozen in DDL

```sql
-- backend/database/schema.sql:826
status text NOT NULL DEFAULT 'pending_admin_review'
  CHECK (status IN ('pending_admin_review','under_exec_review',
                    'under_supervisor_review','pending_admin_final',
                    'ready_to_launch','launched'))

-- backend/database/schema.sql:729
CONSTRAINT chk_site_budget_status
  CHECK (status IN ('draft','pending_supervisor','pending_admin','approved','rejected'))
```

Two modules, two *different* hand-rolled multi-level approval patterns, both as CHECK constraints. Adding a level to either is a migration. The third module to need this will invent a third pattern, because inventing one is cheaper than generalising.

### Assignees are implicit

There is no row anywhere stating "level 2 of the launch approval goes to the module supervisor." It is the shape of the code: whichever endpoint flips the status, guarded by whichever role decorator sits on it. You cannot query "who approves what" — you can only read the routers.

**Cost of one change today:** "Design before Finance, with two approvers instead of one" = two Python edits + one migration + a deploy + an audit of the frontend mirror.

---

## Step 1 — Order becomes edges

### The insight

You already have the edges. The mirror columns on `sites` — `legal_dd_status`, `finance_status`, `design_status`, `project_status`, `is_launched` — are completion signals. An edge *Legal → Design* is nothing more than the fact that Design's gate mentions `legal_dd_status`.

### What changes

The rule moves from a Python function into `action_type.preconditions`, as JsonLogic:

```json
{"and": [
  {"==": [{"var": "legal_dd_status"}, "positive"]},
  {"==": [{"var": "finance_status"},  "approved"]}
]}
```

Reordering is then a rewrite of two rules. To put Design before Finance:

- **Design** drops its `finance_status` clause → `{"==":[{"var":"legal_dd_status"},"positive"]}`
- **Finance** gains a `design_status` clause

### Why no `flow_edges` table

The graph is **derived, not stored**. Drawing it means reading the preconditions; editing a node means rewriting them. A separate edge table would be a second source of truth that could disagree with the rule actually enforced at runtime — which is precisely the class of bug you already have with `schema.sql` / `verified.sql` / `models.py` disagreeing 30/29/24.

This is also the ruling already recorded in `Matrix_V3_Platform_Path.md` §3: *the visual designer edits preconditions and renders the graph; it does not own tables.*

### See it

In [`designer.html`](./designer.html), expand **Design** and untick the **Finance** chip. The generated rule loses its `and` immediately.

---

## Step 2 — Levels become rows

Preconditions answer *"can this module start?"* They say nothing about *"how many people sign off inside it."* That needs the one new table this design adds.

```sql
CREATE TABLE ontology.approval_step (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  version_id    uuid NOT NULL REFERENCES ontology.ontology_version(id) ON DELETE CASCADE,
  action        text NOT NULL,     -- e.g. 'launch.approve'
  seq           int  NOT NULL,     -- 1, 2, 3 …
  label         text NOT NULL,     -- 'Supervisor review'
  status_value  text NOT NULL,     -- what the record sits in awaiting this level
  assignee_rule jsonb NOT NULL,    -- Step 3
  on_reject     text,              -- which status to fall back to
  CONSTRAINT uq_approval_step UNIQUE (version_id, action, seq)
);
```

### What changes

`launch_approvals`' six-value CHECK becomes **four rows** (four sign-offs plus a start and an end state). `site_budgets`' chain becomes **two rows**. Both modules stop carrying their own bespoke pattern.

The status values are now *generated from* the rows rather than *constrained by* DDL. Adding a level is an `INSERT`. Removing one is a `DELETE`.

### The migration question

You do not drop the CHECK constraints on day one. The safe order:

1. Add `approval_step` and populate it to describe the chains that already exist
2. Have the services read the chain from the registry, still writing the same status strings
3. Confirm behaviour is identical — the existing CHECK is now a *safety net* proving the generated values match
4. Only then relax the constraint, and only for modules a client actually needs to vary

Step 3 is the important one. If the registry produces a status the CHECK rejects, the write fails loudly rather than corrupting the chain.

### See it

In [`designer.html`](./designer.html), expand **Launch** — four levels, matching the real six-status chain. Add and remove levels and watch the status chain rebuild.

---

## Step 3 — Assignees become a resolution rule

`assignee_rule` is a small, closed vocabulary. Crucially it maps onto machinery you have already built:

| Rule | Resolves to | Existing mechanism |
|---|---|---|
| `{"kind":"role","role":"supervisor","module":"design"}` | Design supervisors | `user_module_memberships` |
| `{"kind":"role","role":"business_admin"}` | Tenant admins | `business_admins` |
| `{"kind":"object_field","field":"supervisor_id"}` | *This site's* supervisor | `sites.supervisor_id` |
| `{"kind":"site_delegation","module":"design"}` | The per-site delegate | `site_delegations` |

That last row matters. You built per-site, per-module delegation with grant/revoke already. It stops being a special case bolted onto each module and becomes one approver kind among four.

### Keep it closed

`assignee_rule` must **not** become a general expression language. Four to six kinds, each resolving to a set of user ids, each independently testable. When routing genuinely needs computation — "the approver is whoever signed the last budget over ₹50L in this city" — that is a `function_ref`, not a bigger rule grammar.

### A note on roles

`backend/app/rbac/roles.py` defines **four** roles, not three: `business_admin`, `observer`, `supervisor`, `executive`. `observer` is read-everything / write-nothing, enforced at `app/core/deps.py` rather than in the guards. An observer must therefore **never** be resolvable as an assignee — they cannot act. Worth an explicit exclusion in the resolver, not an assumption.

---

## Step 4 — Fields become rows

Different mechanism, same principle. This is the "can a client add or rename a column" question.

### Today

Adding a field to a client's Site = migration → SQLAlchemy model → Pydantic schema → router → API client → form → table column. Seven files and a deploy — and it lands for **every** tenant whether they want it or not.

### With the registry

One row:

```sql
INSERT INTO ontology.property_def
  (version_id, object_type, api_name, display_name, type, storage, column_name)
VALUES (qsr_overlay_version, 'Site', 'franchiseRoyaltyPct',
        'Franchise Royalty %', 'decimal', 'props_json', 'franchise_royalty_pct');
```

`storage` carries the whole design:

| `storage` | Where the value lives | When to use it |
|---|---|---|
| `column` | A real typed column | Every base property. Fast, indexed, constrained |
| `props_json` | A key in one `props jsonb` column, GIN-indexed | Tenant- or vertical-specific additions. No migration |
| `derived` | Recomputed by the runtime | Mirror columns become these |

**Renaming** is the same row with a different `display_name`. The physical column never moves, so nothing breaks — `expected_rent` stays `expected_rent` on disk; tenant B just sees "Base Rent".

**Overlay authority is add and rename only, never remove.** A client who could delete a base property would break your own applications.

### The escape hatch that keeps it fast

When a client starts filtering hard on a `props_json` field, promote it: same `api_name`, `storage` flips to `column`, backed by a real generated column. Queries get fast; nothing above the registry notices. **No EAV table, ever** — that would defeat the query planner and your constraints.

### See it

In [`console.html`](./console.html), switch to **QSR Brands Ltd**: `Site` reads as `Outlet`, `expected_rent` reads as `Base Rent`, and `Franchise Royalty %` appears out of `props`.

---

## Step 5 — What runs at request time

Putting the pieces together. The ordering is not cosmetic.

```
lock the row              SELECT … FOR UPDATE   (fetch_site_for_update_or_404, _common.py:79)
  ├─ 1  lifecycle         is the object in a status where this action exists?
  ├─ 2  identity          required_role / required_module — 403, and it must not leak why
  ├─ 3  preconditions     the JsonLogic gate — 422, and it should say what is missing
  ├─ 4  approval step     is the caller the assignee for the CURRENT seq?
  ├─ 5  mutate            advance to the next step's status, or to done on the last one
  ├─ 6  recompute         derived / mirror columns
  ├─ 7  audit             audit_logs + stage_events
  └─ 8  notify            notification_outbox
```

### Two things to get right

**Preconditions must be evaluated inside the lock.** If the gate is checked before `SELECT … FOR UPDATE`, two concurrent requests can both read `finance_status = 'approved'`, both pass, and both mutate. Today this is safe by accident, because `_assert_design_unlocked(site)` receives a site already fetched under lock. Extracting the gate into a generic evaluator makes that coupling easy to lose — keep the context load and the evaluation both inside the locked transaction.

**Checks 1–4 fail differently and must respond differently.** A lifecycle failure means the button should never have rendered. An identity failure is a 403 that must not explain the workflow to an unauthorised caller. A precondition failure is a 422 that *should* explain exactly what is missing, because it is your own user's next action. Collapsing them into one "denied" is both worse UX and an information leak.

---

## What this actually buys, honestly

### Real value

- **Client #2 onward.** A second client with a different approval order is a fork today; this makes it an overlay. That is the whole commercial thesis, and it holds.
- **The drift disappears.** The flow order is currently stated four times and hand-synced. A JsonLogic rule is data — it can be shipped to the browser to grey out a button *and* enforced on the server, from one row. It is structurally incapable of drifting.
- **Approval chains stop being migrations.** Two modules have already invented two different multi-level patterns. This stops the third.
- **"Who approves what" becomes queryable.** Today it can only be read out of the routers.

### Real costs

- **For a single tenant this is close to worthless.** One client, one flow, one vocabulary — you would be paying indirection for flexibility nobody uses. The value starts at client #2. The honest question is not technical: it is how close that client is.
- **Debuggability gets worse before it gets better.** A stack trace through `_assert_design_unlocked` tells you exactly which branch failed. A rule row tells you `False`. You need gate-evaluation tracing — which rule, which operand, which value — or you have traded a deploy for a support burden.
- **You lose the compiler.** A malformed `if` will not start. A malformed rule row just *permits* — see `Palantir_Evaluation.md` §6. The validator has to ship with the first gate, not after.
- **Config sprawl is the standard failure.** Preconditions want to become a programming language. Draw the `function_ref` line on day one: loops, aggregates, external calls, and anything over three levels of nesting are code.

### The trap

Building the registry and continuing to hardcode alongside it, paying for both. The forcing function is the exit test in `Build_Sequence.md` Stage F — a new object type shipped config-only. Until that passes, the registry is cost with no return.

---

## What to build first

| | Scope | Worth it? |
|---|---|---|
| **Now** | One gate — `design.open` — moved to `action_type.preconditions`, with the fail-closed validator and evaluation tracing | **Yes, on its own merits.** It removes a rule duplicated across two definitions and five call sites, and proves the mechanism. ~2 weeks |
| **Next** | The policy compiler (row-level security) | **Yes, independently.** It closes a gap that exists in production today, platform or no platform |
| **When a second client asks** | `approval_step`, `assignee_rule`, the designer UI | Wait for the demand. Building the editor before there is a second flow to express is how this architecture usually dies |

---

## Appendix — the full picture

| Concern | Today | After | Table |
|---|---|---|---|
| Module order | `workflow_unlocks.py:25` + `design_service.py:230` | Edges derived from rules | `action_type.preconditions` |
| Approval levels | CHECK constraints (`schema.sql:729`, `:826`) | Rows | `approval_step` |
| Who approves | Implicit in route guards | Resolution rule | `approval_step.assignee_rule` |
| Add a field | Migration + 6 files | One row | `property_def` (`storage='props_json'`) |
| Rename a field | Not possible per tenant | One row | `property_def.display_name` |
| Client's own table | Not possible | One row | `datasource_binding` |
