# Matrix vs. Palantir Foundry — an architectural evaluation

**Written:** 2026-08-10 · **Branch:** `ontology` (experimental, never merged to main)
**Verified against:** Palantir's public Foundry documentation, and Matrix code as recorded in `Matrix_V3_Platform_Path.md` §2 (checked against the repo 2026-08-02)

---

## 0. The thesis being tested

> A **vertical Palantir**: Foundry connects to arbitrary databases and lets you model from scratch. Matrix ships a *pre-configured* retail-expansion ontology and base flow that a client maps their existing databases onto, then edits — reordered approvals, renamed and added fields, captured relationships — with modules built on top and shipped as applications hanging off the main workflow.

The thesis is sound. The rest of this document is about which parts you already have, which parts are missing, and which parts Palantir itself has not solved.

### One correction, stated up front

Foundry is **not** a semantic-web system. It uses no RDF, no OWL, no SPARQL, and no triplestore. Its ontology is a proprietary object model over datasets, served by its own Object Set Service. Every primitive below is implementable on Postgres, and `Matrix_V3_Platform_Path.md` already specified them that way.

RDF is therefore optional and peripheral — useful only as a read-only interop surface for a client who refuses to let their ERP be copied, which is exactly where `Matrix_V2_Ontology_Roadmap.md:100` already placed Ontop. It is a sales-objection answer, not the architecture.

---

## 1. Foundry's primitive stack

| Primitive | What it does | Notable detail |
|---|---|---|
| **Object type** | Schema of an entity. One row of a backing datasource = one object | Selecting a datasource **auto-maps every column** to a property, which you then prune |
| **Property** | Column analog | **Shared properties** are reusable across object types |
| **Link type** | Declared relationship | 1:1, 1:N, N:M |
| **Action type** | The write path: parameters, rules, submission criteria, side effects | Criteria combine user, parameter, object *and relation* context into one logical statement |
| **Side effects** | Notifications + webhooks | Ordering is deliberate: a **writeback** webhook runs *before* rules (failure blocks everything); a **side-effect** webhook runs *after* edits land. Off by default; needs extra permissions |
| **Functions** | Server-side TS/Python over objects | Callable from actions and UI |
| **Interfaces** | Polymorphism | Composed of interface properties, **link type constraints**, and **action type constraints**. An object type implements one by *mapping its own properties onto the shared ones* |
| **MDO** | One object type, multiple datasources | **Column-wise only.** Max 70 sources, no property multiplicity, no streaming |
| **Branches + proposals** | Ontology change control | A proposal is a pull request: merge checks, conflict detection, per-resource approval, self-approval if you own the resource |
| **Marketplace products** | Packaging | Self-contained, reproducible, **cryptographically signed**, installed across enrollments with **API-name consistency preserved** |
| **OSDK / Developer Console** | Generated typed client | TS, Python, Java — from a *selected subset* of object and action types |
| **Workshop** | Low-code app builder | Widgets bound to ontology data |
| **Security** | Projects, orgs, roles, markings | Missing datasource permission renders a property **`null`**, not an error |

### The two things Foundry gets right that clones miss

1. **Security lives on the object type, not the datasource.** A row's visibility is a property of the ontology, so it holds identically whether the object is native, ingested, or federated — and identically for a UI click, an SDK call, and an agent.
2. **Writes only ever happen through Actions.** Not "mostly." The audit ledger, the notification fan-out, and the third-party trust story all depend on there being exactly one write path.

---

## 2. Scorecard

| Foundry primitive | Matrix today | Verdict |
|---|---|---|
| Action runtime | `assert_transition → mutate → audit → notify`, row-locked via `fetch_site_for_update_or_404` (`_common.py:79`) | ✅ **Already correct** |
| Audit ledger | `audit_logs`, `stage_events` | ✅ Better than most clones |
| Side-effect fan-out | `notification_outbox` | ✅ Right shape, not declared per-action |
| RBAC roles | 3 roles × orthogonal module membership | ✅ Clean |
| **Submission criteria** | `_assert_design_unlocked` (`design_service.py:229`), `workflow_unlocks.py` — **Python** | ❌ blocks req. #3 |
| Object type | 24 hardcoded classes; 3 schema sources disagreeing 30/29/24 | ❌ not data |
| Property | Columns only; no display name, no rename, no add | ❌ blocks req. #4 |
| Link type | Real FKs, never declared | ❌ blocks req. #5 |
| Interfaces | Absent — but approvals, delegation, documents, budgets are *already* four generic behaviours | ❌ blocks req. #7 |
| Datasource backing | 100% native Postgres, no seam | ❌ blocks req. #2 |
| Row-level security | Ad hoc per route (`restrict_to_site_ids`) — no single authority | ❌ breach-class |
| Branches / proposals | None | ❌ |
| Packaging | None | ❌ blocks req. #7 |
| Typed SDK | 20 hand-written API clients | ❌ |
| App builder | 20 React module folders, 172 files | ❌ |

**The read.** You already own the expensive half — the write path, the audit ledger, the role model. Most Foundry clones never get those right, and they cannot be retrofitted cheaply. What you lack is that every primitive *above* them is Python control flow rather than data. That is **one problem with one shape**, not fifteen problems.

---

## 3. Requirements → what actually delivers each

| # | Requirement | Delivered by | Proven in `poc/` |
|---|---|---|---|
| 1 | Pre-configured base flow, editable | `action_type` rows + base package | ✅ |
| 2 | Client connects existing DB, mapped to predefined models | `datasource_binding` + `column_map` + `value_map` | ✅ proof 2 |
| 3 | **Approval flow reorder** | `action_type.preconditions` as JsonLogic | ✅ proof 3 |
| 4 | Rename fields, add fields | `property_def.display_name` + `props` JSONB | ✅ proof 4 |
| 5 | Relationships captured | `link_type` declared over existing FKs | ✅ proof 5 |
| 6 | Suggest models when a client DB doesn't map *(you ranked last)* | Schema matching against a **fixed** target | ✖ not built |
| 7 | Modules shipped as apps off the main workflow | Interfaces + packages + versioning | ◐ interfaces proven, packaging not |

Requirements 1, 3, 4 and 5 **all reduce to one body of work**: the registry plus JsonLogic preconditions. No RDF, no new datastore, no rewrite of the write path. That is why it is the correct first move.

---

## 4. Where the vertical constraint makes this *easier* than Foundry

This is the strategic core of the idea, and it holds.

- **A fixed target schema turns an open problem into a bounded one.** General schema matching is unsolved. Matching a client's tables against **~8 known object types** is tractable — the literature reports automated field recognition cutting manual mapping effort by >60% in standard scenarios, with suggestions improving when driven by a repository of prior mappings. Every client onboarded makes the next cheaper. **Foundry cannot have this asset, because its target is arbitrary.** This is your durable advantage, and it is the answer to requirement #6.
- **You skip most of Foundry's surface.** No Pipeline Builder, no Code Repositories, no general ontology editor, no Workshop fidelity. Your editor only ever edits a constrained overlay.
- **Constrained overlay semantics.** Add + rename only, never remove. One rule that keeps your own apps working across every client.

---

## 5. Where Foundry itself hit walls — do not over-promise

- **Row-wise MDOs are unsupported even in Foundry.** You cannot cheaply union a client's three regional store databases into one `Site`. Column-wise joins on a shared primary key work; unions need a different mechanism.
- **Interface action rules can only modify shared properties or delete objects.** Interfaces carry less behaviour than you would hope — budget for module-specific actions.
- **70 datasources per object type**, no property multiplicity.
- **Webhook side effects are off by default.** Treat egress as privileged from day one.
- **Copy the null-not-error pattern.** Missing datasource permission should render a property `null`, not fail the request.

### The gap Foundry solves with transforms and you must solve declaratively

Column mapping alone is **not enough**. A client's ERP says `CLEARED` where your ontology says `positive`, and `LIVE` where yours says `approved`. Foundry pushes this into a pipeline transform. The PoC declares it as `datasource_binding.value_map` instead, which keeps it inspectable and per-tenant — but note that this only covers 1:1 value translation. Anything requiring computation still needs a `function_ref`.

---

## 6. The most dangerous failure mode, found by building it

While writing the PoC, a rule stored through the wrong code path round-tripped out of Postgres as a **JSON string** rather than a JSON object. JsonLogic treats a non-object as a *literal*, and a non-empty literal is truthy — so the gate evaluated `True` unconditionally. **A corrupted precondition silently becomes an always-open approval gate**, and the demo still printed a pass.

This is the specific risk of moving gates from code to data: a Python `if` that is malformed raises; a malformed rule row just permits. `resolver.evaluate_gate()` now fails closed on any non-object rule, and the demo asserts the rule's *shape*, not only its verdict. Any real implementation needs the same guard plus a CI check that validates every `preconditions` row against a schema before it can be published.

---

## 7. Honest effort assessment

`Matrix_V3_Platform_Path.md` budgets **9–12 months to Stage 5 with 2–3 engineers**. The V2 risk table records that you are solo and also interning. Those do not reconcile — the full vertical-Palantir as scoped is a multi-year solo project, and no sequencing fixes that.

| Slice | Realistic solo effort | Value |
|---|---|---|
| Registry + JsonLogic preconditions (req. 1/3/4/5) | Weeks, against existing tables | **Highest** — four requirements, demoable |
| Policy compiler (row-level security) | Weeks | Non-negotiable; closes a breach-class gap |
| Datasource binding + mapping (req. 2) | Months | The client-onboarding sales motion |
| Packaging + versioning (req. 7) | Months | The commercial milestone |
| Model suggestion (req. 6) | Months | Correctly ranked last |

**The trap**, already flagged in V3 §7: building the registry and continuing to hardcode alongside it, paying for both. The forcing function is the exit test — ship one new object type using config only. Until that passes, the registry is cost with no return.

---

## 8. Verdict

The vision is coherent and the foundation is real. You have Foundry's hardest primitive — a single, audited, row-locked write path — already built and working in production. The gap is that the object model, the gates, and the security predicate are expressed as code instead of data.

The vertical constraint is not a limitation to apologise for; it is the reason a small team can attempt this at all, and the fixed target schema is a compounding asset Palantir structurally cannot have.

The honest risk is not technical. It is that this is a multi-year build competing for the attention of one person who also has a paying design partner to keep shipping for.

---

## Sources

**Foundry** — [Ontology core concepts](https://www.palantir.com/docs/foundry/ontology/core-concepts) · [Platform summary](https://www.palantir.com/docs/foundry/getting-started/foundry-platform-summary-llm) · [Object types](https://www.palantir.com/docs/foundry/object-link-types/object-types-overview) · [Link types](https://www.palantir.com/docs/foundry/object-link-types/link-types-overview) · [Submission criteria](https://www.palantir.com/docs/foundry/action-types/submission-criteria) · [Rules](https://www.palantir.com/docs/foundry/action-types/rules) · [Webhooks](https://www.palantir.com/docs/foundry/action-types/webhooks) · [Interfaces](https://www.palantir.com/docs/foundry/interfaces/interface-overview) · [Implement an interface](https://www.palantir.com/docs/foundry/interfaces/implement-interface) · [Actions on interfaces](https://www.palantir.com/docs/foundry/action-types/actions-on-interfaces) · [MDOs](https://www.palantir.com/docs/foundry/object-permissioning/multi-datasource-objects) · [Create an object type](https://www.palantir.com/docs/foundry/object-link-types/create-object-type) · [Proposals](https://www.palantir.com/docs/foundry/ontologies/ontologies-proposals) · [Marketplace products](https://www.palantir.com/docs/foundry/marketplace/foundry-products) · [OSDK](https://www.palantir.com/docs/foundry/ontology-sdk/overview)

**Schema matching** — [Agent-based automatic schema matching](https://arxiv.org/pdf/2501.04136) · [Automatic semantic modeling with prior knowledge](https://arxiv.org/pdf/2212.10915)

**Internal** — `Matrix_V3_Platform_Path.md`, `Matrix_V2_Ontology_Roadmap.md`, `backend/database/schema.sql`
