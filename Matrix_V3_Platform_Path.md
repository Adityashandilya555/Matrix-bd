# Matrix V3 — From Application to Platform

**One document. It supersedes five.**

| Superseded doc | What survives from it | What is dropped |
|---|---|---|
| `Matrix_V2_Ontology_Roadmap.md` | LinkML-as-single-source-of-truth; registry primitives; dlt; `factor_edge`; the "new object type via config only" exit test | Its phase ordering — it builds the registry against Postgres-only, then bolts on ingestion, which forces a rewrite of the read path |
| `docs/14-dynamic-platform/dynamic-flow-transformation-plan.html` | `execute_transition()` extraction; JsonLogic; version-stamping in-flight records; the outbox-worker pattern | `flow_definitions`/`flow_nodes`/`flow_edges` as separate tables; `field_definitions` as a separate registry; the `catalog` connector framework; "modules stay black boxes" as a terminal state |
| `Matrix_dev/01_Business_Domains/Foundry_Evolution_Roadmap.md` | The Foundry layer-cake mental model; ontology YAML; Actions-as-runtime | Its 7-phase sequencing and the Iceberg/Dagster/dbt stack expansion — premature at your data volume |
| `Matrix_dev/01_Business_Domains/AI_Command_Center_Architecture.md` | Governed-metric layer; agent selects metrics, never writes SQL | Its position in the sequence — it is Stage 7, not a parallel track |
| `Matrix_dev/01_Business_Domains/Slack_Ontology_Retail_OS.md` | Slack as an I/O surface; outbox is already Slack-shaped | Slack as a distinct workstream — it becomes one app on the app layer (Stage 5) |

Mark all five `status: superseded_by: [[Matrix_V3_Platform_Path]]` per the Tombstone Protocol in `Matrix_dev/claude.md`.

---

## 0. What you are actually building, stated once

A **vertical ontology platform for multi-site retail expansion**: one kernel that holds the object model, the write path, and the security model; N client configurations on top of it; N applications — yours first, third parties later — reading and writing through one generated API.

Three properties define "done":

1. **A new object type, property, link, or approval gate costs a config change, not a deploy.**
2. **A new client costs an overlay file, not a fork.**
3. **A new application — yours or someone else's — costs a manifest and a generated SDK, not a hand-written API.**

The word "OS" is doing real work here and it is worth being precise about which part is the OS. It is not the UI and not the database. It is the **execution layer**: the single place where *every* read is authorized and every write is validated, applied, audited, and fanned out. AWS's internal platform worked because Bezos's mandate forced all teams through one interface, not because the interface was clever. Your equivalent mandate is: **nothing writes to Postgres except the Action runtime.**

### The deliberate limit

This is a **vertical** platform, not a Foundry clone. You ship a base retail-expansion ontology — Site, Agreement, DueDiligence, Budget, Review, Launch — and clients overlay it. That constraint is what makes "no rewrite per client" achievable by a small team. A general-purpose platform with no opinion about the domain is a five-year project with a much lower success rate. You already said you're willing to define the domain; this document takes you at your word and treats it as the central design decision.

---

## 1. Palantir reference architecture — what to copy, what to skip

Foundry is worth studying because it is the only mature implementation of exactly this pattern. Here is its actual layering and the honest Matrix equivalent.

| Foundry layer | What it does | Matrix equivalent | Build it? |
|---|---|---|---|
| **Data Connection / virtual tables** | Connectors into source systems; a *virtual table* is a pointer to an external table — queried in place, never copied | `datasource_binding` with kinds `native` \| `ingested` \| `virtual` | Yes — the **seam** in Stage 1, implementations in Stage 6 |
| **Ontology Metadata Service (OMS)** | The registry: object types, link types, action types, interfaces, shared properties, value types | `ontology.*` tables, **compiled** from LinkML | Yes — Stage 1 |
| **Object Storage V2 + Object Data Funnel** | Indexes datasource rows *and* user edits into purpose-built object databases; edits land in a writeback dataset | Postgres directly. You have ~27 tables and one tenant. A separate index layer is unjustified until a client's object count forces it | **No** — skip; keep the seam so you can add it |
| **Object Set Service** | Query, filter, aggregate, traverse links over object sets | `/objectSets/query` compiled to SQL with pushdown | Yes — Stage 1 |
| **Actions** | Parameters, rules, submission criteria, side effects (notify/webhook/schedule), function-backed actions, action log, reverts | You already have this shape in `assert_transition → mutate → audit → notify`. It becomes registry-driven | Yes — Stages 0 & 2 |
| **Functions** | Versioned TS/Python compute over objects, callable from actions and UI | Named Python callables in a registry, referenced by name from config | Yes — Stage 2, minimal |
| **Interfaces / shared properties** | A shape multiple object types implement; actions and links can be declared on the interface | `interface`, `interface_impl` — `Approvable`, `Delegatable`, `Documented`, `Budgeted` | Yes — Stage 3. This is the single highest-leverage primitive for you |
| **Object & property security policies** | Row-level and column-level security configured on the object type, *independent of* the backing datasource; markings inherited from sources | Policy compiler: tenant + role + module + delegation → SQL predicate, injected by the resolver | Yes — Stage 1, non-negotiable |
| **OSDK** | Per-ontology generated client (TS/Python/Java/OpenAPI). v2 scales with the ontology's *shape*, not its size | Generated TS + Python client from `/meta/ontology` | Yes — Stage 5. This is your third-party story |
| **Marketplace / DevOps products** | Package ontology + apps as a product; install into another enrollment, optionally prefixing every API name | Ontology packages: base vertical + client overlay, installed per tenant with display-name overrides | Yes — Stage 4. This is your multi-client story |
| **Ontology branching / proposals** | Draft, review, publish ontology changes | `ontology_version` + proposal/diff/publish; objects stamped with the version they were created under | Yes — Stage 4 |
| **AIP** | Agents over the ontology, acting through Actions | MCP server generated from `action_type` | Stage 7 |
| **Workshop, Vertex, Machinery, Map, Foundry Rules** | Point-and-click app builders and analysis surfaces | One config-driven object-view/action-form renderer | A thin version in Stage 3. Do not chase Workshop fidelity |

**The two things Foundry gets right that most clones miss**, and that you must not compromise on:

- **Security lives on the object type, not the datasource.** A row's visibility is a property of the ontology, so it holds identically whether the object is native, ingested, or federated — and identically for a UI click, an SDK call, and an agent. If you implement security per-router (as today), the app layer in Stage 5 is unshippable.
- **Writes only ever happen through Actions.** Not "mostly." The audit ledger, the notification fan-out, the derived-property recompute, and the third-party trust story all depend on there being exactly one write path.

---

## 2. Where you stand — ground truth from the code

Read before writing this, not assumed.

| Layer | Reality |
|---|---|
| Object types | Hardcoded across `backend/app/db/models.py` (1,127 lines, 24 mapped classes) |
| Schema truth | Three competing sources that **measurably disagree today**: `schema.sql` has 30 tables, `verified.sql` has 29, `models.py` has 24. Seven tables (`business_admins`, `module_codes`, `password_reset_requests`, `supervisor_executive_requests`, `supervisor_invite_codes`, `user_module_memberships`, `workspace_requests`) exist in SQL with no ORM model; `quality_audit_reports` has a model with no entry in `schema.sql`. Plus 52 migrations layered on top |
| Write path | **Correct and consistent**: `assert_transition → mutate → write_audit_event → notification outbox`, with `SELECT … FOR UPDATE` via `fetch_site_for_update_or_404` (`_common.py:79`). This is the asset the whole plan is built on |
| API surface | 19 hand-written routers (5,161 lines) + 29 domain services (13,826 lines) — one vertical slice per business concept |
| Orchestration | Stated **four times** and hand-synced: `ALLOWED_TRANSITIONS` in `state_machine.py`, its mirror in `frontend/src/lib/stateMachine.js`, `workflow_unlocks.py`, and per-service asserts (`_assert_design_unlocked` at `design_service.py:229`, `_assert_launched`, project/NSO gates) |
| Inter-module signalling | Mirror columns on `sites` — `legal_dd_status`, `finance_status`, `design_status`, `project_status`, `is_launched`. A good pattern; currently maintained by hand |
| RBAC | Clean: 3 roles × orthogonal module membership. `require_scope()` no longer exists — it was deleted since `CODEBASE_REVIEW.md` §SEC-02 flagged it, so the stale "live 500" warning repeated in the V2 roadmap and the vault docs is **wrong**. `guards.py` now has exactly `require_role` and `require_module`. The real gap is different and worse for a platform: row-level scoping is implemented ad hoc per route (e.g. `restrict_to_site_ids` threaded through `svc_design_queue`), so there is **no single place** that decides what a caller may see |
| Frontend | 20 module folders, 172 files, one API client per module |
| Tests | 43 files in `backend/tests/` — this is your safety net for everything below |

**Diagnosis in one line:** the object model, the security model, and the orchestration all exist only as Python control flow, so every new object type, client vocabulary, or approval order is a vertical slice through five files and a deploy.

---

## 3. The rework audit — where your existing plans collide

This is the section you asked for. Each row is real duplicated work that would have happened if both plans ran.

| Concern | Dynamic-flow plan says | V2 ontology plan says | The repeat | **Ruling** |
|---|---|---|---|---|
| **Dynamic fields** | `flow.field_definitions` + JSON Schema + an `extra` JSONB column per head table | `property_def` registry + `props` JSONB, generated from LinkML | Two field registries; two JSONB columns per table; two validation paths | **One** `property_def`. The JSON Schema that RJSF renders is *emitted from* it, not authored separately. One `props` column |
| **Gates / rules** | `flow_nodes.entry_gate` JsonLogic + `flow_edges` | `action_type` validation rules | Two rule engines, two authoring UIs, two evaluators | **One**: `action_type.preconditions` in JsonLogic. The module graph is a *derived view* of action preconditions — the visual designer edits preconditions and renders the graph, it does not own tables |
| **Flow designer UI** | Build it in weeks 5–6, over the black-box module graph | (not addressed) | Built against `flow_*` tables, then rebuilt against `action_type` | **Defer** the designer until after the action registry exists (Stage 3+), then build it once |
| **Ingestion** | `catalog` schema, hand-rolled worker, 4 connectors, dlt optional | dlt embedded, `connection`/`source_schema_snapshot`/`ingest_run`, landing schema | Two connector frameworks, two job tables | **One**: dlt + `connection`/`ingest_run`, plugged into the `datasource_binding` seam |
| **Read path vs. federation** | Ingestion lands in `raw.*`, consumed by transforms | Ingestion is Phase 2, after the registry is built Postgres-only | Both build the object read path assuming local Postgres, then retrofit external sources → **the generic query API gets rewritten** | **Introduce the datasource seam in Stage 1**, with only `native` implemented. Adding kinds later is then additive |
| **Module strategy** | Modules stay black boxes; wrap them, don't rewrite | Modules become object types in the registry | Wrapping 20 modules, then unwrapping them | **Wrap the orchestration, not the modules.** Black-boxing is the right *transition* technique and the wrong *destination* |
| **Versioning** | `flow_definition_id` stamped on each site | (not addressed) | — | **Widen it**: stamp `ontology_version_id`, not `flow_version`. One version concept covers schema, fields, gates, and views |
| **First step** | Extract `execute_transition()` | LinkML codegen + kill schema drift | — | **Both, in parallel.** They touch disjoint files (services vs. models) and each is a prerequisite for Stage 1 |
| **Mirror columns** | Keep as the signalling bus | Implicitly replaced by links/derived properties | Status maintained in two places | **Keep them, but declare them.** They become derived properties recomputed by the runtime, so a new module gets its mirror without a migration |

---

## 4. Target architecture

```
                    ┌──────────────────────────────────────────────┐
   YOUR APPS ───┐   │  Third-party apps · Slack · agents · client   │
   (BD, Legal,  ├──▶│  BI tools · client's own frontend            │
    Design …)   │   └──────────────────────────────────────────────┘
                │                      │
                │        generated SDK · REST · webhooks/subscriptions
                ▼                      ▼
   ╔═══════════════════════════════════════════════════════════════╗
   ║                    THE KERNEL (execution layer)               ║
   ║                                                               ║
   ║   /meta/ontology     /objectSets/query    /actions/*/apply    ║
   ║        │                    │                    │            ║
   ║   ┌────┴────┐      ┌────────┴────────┐   ┌───────┴────────┐   ║
   ║   │ REGISTRY│      │  READ RESOLVER  │   │ ACTION RUNTIME │   ║
   ║   │ object  │      │  + policy       │   │ lock→precond→  │   ║
   ║   │ property│─────▶│    compiler     │   │ mutate→derive→ │   ║
   ║   │ link    │      │  (row + column  │   │ audit→notify   │   ║
   ║   │ action  │      │   security)     │   └───────┬────────┘   ║
   ║   │ iface   │      └────────┬────────┘           │            ║
   ║   └────┬────┘               │                    │            ║
   ║        │ compiled from      │                    │            ║
   ║   ┌────┴──────────────┐     │                    │            ║
   ║   │ ontology packages │     │                    │            ║
   ║   │ base + overlays   │     │                    │            ║
   ║   │ (LinkML, versioned)│    │                    │            ║
   ║   └───────────────────┘     │                    │            ║
   ╚═════════════════════════════│════════════════════│════════════╝
                                 ▼                    ▼
              ┌──────────────────────────────────────────────────┐
              │  DATASOURCE BINDINGS                             │
              │  native (your Postgres) · ingested (dlt→landing) │
              │  virtual (read-through to client Oracle/MySQL)   │
              └──────────────────────────────────────────────────┘
```

### The registry (Stage 1 tables, `ontology` schema)

```
ontology_version   id, tenant_id (null = base), package, semver, status(draft|published|retired), parent_id
object_type        id, version_id, api_name, display_name, plural, primary_key, icon, implements[]
property_def       id, object_type_id, api_name, display_name, type, required, constraints(json),
                   storage(column|props_json|derived), derived_expr(json), sensitivity
link_type          id, version_id, api_name, from_type, to_type, cardinality, backing(fk|join_table), display
interface          id, version_id, api_name, required_properties[], required_links[], required_actions[]
interface_impl     interface_id, object_type_id, property_mapping(json)
action_type        id, version_id, api_name, object_type_id, from_status[], to_status,
                   preconditions(jsonlogic), required_role, required_module, side_effects(json)
action_param       action_type_id, api_name, type, required, default_expr, options_query(json)
function_ref       id, version_id, api_name, python_path, signature(json)
datasource_binding object_type_id, kind(native|ingested|virtual), connection_id, table_ref, column_map(json)
security_policy    id, object_type_id | property_ids[], scope(row|column), predicate(jsonlogic)
```

**The registry is a compiled artifact.** Authoring happens in LinkML YAML (`ontology/base/*.yaml`, `ontology/tenants/<slug>/*.yaml`); a compiler writes the rows. Nobody hand-edits these tables — including the eventual admin UI, which edits the YAML and recompiles. This single rule is what prevents the drift you already have between `schema.sql`, `verified.sql`, and `models.py` from reappearing one layer up.

### The generic API — the thing that ends hand-written endpoints

```
GET  /api/v1/meta/ontology                 # full shape; SDK generators read this
GET  /api/v1/objects/{type}/{id}
POST /api/v1/objectSets/query              # filter, aggregate, traverse links, paginate
POST /api/v1/actions/{action}/validate     # returns per-parameter errors + submission criteria
POST /api/v1/actions/{action}/apply        # the only write path in the system
GET  /api/v1/subscriptions                 # + webhook registration for egress
```

Every one of these resolves through the registry and the policy compiler. Adding an object type adds routes without adding code. This is the answer to *"as many operations as I want on the schema without hand-writing an API each time."*

---

## 5. The path — seven stages, no step repeated

Each stage is gated by an exit test. **No stage may start before the previous exit test passes**, because each one consumes an artifact the previous one produces. That dependency, not the calendar, is why the order is what it is.

Durations assume 2–3 engineers with production shipping throughout. Total: **9–12 months** to Stage 5. Anyone promising this in 14 weeks is quoting the happy path.

---

### Stage 0 — One schema truth, one write path · 3–4 weeks · two parallel tracks

**0a — Kill the drift.** Reflect the live schema; diff against `schema.sql`, `verified.sql`, and `models.py`. The 30/29/24 split above is the starting worklist — resolve each of the eight discrepancies explicitly (does `quality_audit_reports` exist in production or not?). Then author `ontology/base/matrix.linkml.yaml` as a *faithful transcription* of the reconciled truth — no redesign. Generate DDL, SQLAlchemy models, Pydantic schemas, and TS types from it. Wire `make check-drift` into CI. Delete `verified.sql`. Migrations remain the deploy mechanism; LinkML becomes the design surface.

**0b — Extract the runtime.** Pull the write choreography out of `bd_service.py` and its 28 siblings into one `execute_transition()` in `_common.py`: `lock → assert precondition → mutate → recompute derived → audit + stage_event → enqueue outbox`. Every service routes through it. Add `GET /meta/workflows` serialising `ALLOWED_TRANSITIONS`; the frontend consumes it and `frontend/src/lib/stateMachine.js` is deleted.

> **Exit test:** zero behavioural change. All 42 test modules in `backend/tests/` green. CI fails on schema drift. The four statements of the flow order have dropped to two (`state_machine.py` + `workflow_unlocks.py`).
>
> **Why it cannot move:** everything downstream is *generated from* the LinkML file and *executed by* the one runtime. A registry built before this gets re-entered from a corrected schema.

---

### Stage 1 — The kernel · 6–8 weeks

Build the registry tables and the LinkML→rows compiler. Build the **read resolver** behind an interface with three datasource kinds — implement only `native`. Build the **policy compiler**: tenant + role + module membership + delegation → a SQL predicate injected into every query. This is where the per-route scoping scattered across services (`restrict_to_site_ids` and friends) collapses into one authority. Build the four generic endpoints.

Migrate three object types onto them — `Site`, `LegalDD`, `SiteBudget` — chosen because between them they exercise the state machine, a checklist, and line items. Their hand-written routers become deprecated shims that delegate.

> **Exit test:** ship a **new** object type (`SiteInsurancePolicy`) end-to-end using only YAML plus generated code. If it needs one hand-written router or service function, Stage 1 is not done. Additionally: an executive's query returns only their delegated sites *because of the policy compiler*, not a router-level filter.
>
> **Why the seam matters here:** if the read path is written against local Postgres and federation is added in Stage 6, the read path is rewritten. Introducing `datasource_binding` now — even with two of three kinds unimplemented — makes Stage 6 purely additive. This is the single most expensive mistake both existing plans would have caused.

---

### Stage 2 — Rules as data · 4 weeks

`action_type.preconditions` in JsonLogic, evaluated against object properties. On the library: `panzi-json-logic` is the closest match to the JS semantics, but it has had no PyPI release in over a year — treat it as a reference implementation and budget for vendoring it. The evaluator you actually need is ~200 lines and the operator set you use is small; owning it is defensible here, and it keeps the expression language from quietly growing. A named-predicate registry (`function_ref`) is the explicit escape hatch for anything JsonLogic can't express — declared, not smuggled in.

Migrate `ALLOWED_TRANSITIONS`, `design_unlock_ready()`, `_assert_design_unlocked`, `_assert_launched`, and the project/NSO gates into rows. Then **delete** `workflow_unlocks.py` and every per-service assert. Mirror columns become declared derived properties, recomputed by the runtime after each action.

> **Exit test:** delete every hardcoded gate; the test suite behaves identically because the evaluator answers from rows. Changing the Legal ∥ Finance join to `any-of` is a YAML edit.

---

### Stage 3 — Interfaces and the generic UI · 6 weeks

Declare `Approvable`, `Delegatable`, `Documented`, `Budgeted`, `Reviewable` and bind them to the machinery you already have — `approvals`, `delegation_service.py`, `site_documents_service.py`, `budget_service.py`. Any new object type inherits all of it by declaring `implements:`.

Add `object_view` and `action_form` config, rendered by one React renderer themed with your existing `modules/shared` primitives so config-driven screens look native. Now — and only now — build the visual designer: a React Flow canvas that renders the graph *derived from* action preconditions and edits those preconditions.

> **Exit test:** one whole module (pick the smallest — NSO or Project Excellence) exists only as config, and its folder under `frontend/src/modules/` is deleted. Adding a field to a form is one YAML line.

---

### Stage 4 — Versioning and packaging · 4 weeks · **the commercial milestone**

`ontology_version` with draft → review → publish, a diff view, and version-stamping on every object so in-flight records finish on the version they started under. Package model: a **base retail-expansion ontology** you ship, plus a **per-client overlay** that adds object types, adds properties, and overrides display names (`Site` → `Outlet` → `Restaurant`) without touching the base. Install applies an API-name prefix where names collide — the Marketplace pattern.

> **Exit test:** onboard a second client with different vocabulary and two extra object types, with **zero commits to the application repo**. That sentence is your sales claim; this is the stage that makes it true.

---

### Stage 5 — The app layer · 6–8 weeks

**Manifest.** An app declares the object types, properties, actions, and links it needs. Install is a grant; the app gets a scoped token that the policy compiler honours identically to a human session.

**SDK.** Generate a typed TS and Python client from `/meta/ontology` per ontology version. Migrate *your own* modules onto it first — dogfood before you expose it. If your apps can't be built on the SDK, no one else's can.

**Egress.** Subscriptions with a declared projection: an external app registers "notify me when `Site.status` enters `legal_approved`, send these six properties." Delivery reuses the outbox pattern already proven in `notification_service.py` — `pending → sent/failed`, capped attempts. The projection passes through the same column-level policy, so an app physically cannot receive a property it wasn't granted.

> **Exit test:** an application you did not write reads a filtered object set and applies an action; the write appears in `audit_logs` with the app's identity; a property outside its grant is absent from the payload, not merely hidden in the UI.

---

### Stage 6 — Datasource kinds 2 and 3 · 8 weeks

**Ingested:** dlt embedded in-process. `connection`, `source_schema_snapshot`, `ingest_run`; raw append-only `landing.<tenant>_<connection>_<table>`. Credentials in Vault/KMS, never a column. Two source kinds first — Postgres/MySQL and file upload (generalising the XLSX path you already have). A **mapping review screen** is mandatory: introspect → profile → derive link candidates from FKs → draft a schema → LLM for naming and descriptions *only, never cardinality* → human accepts per column. Never auto-commit a proposal.

**Virtual:** a read-through resolver to a client's live database with predicate pushdown, a row cap, and a timeout. This is the answer to "we are not copying our ERP into your Supabase."

> **Exit test:** one object type backed by a client's external database with nothing copied, one backed by an ingested POS feed, one native — and the SDK, the UI, and the policy compiler cannot tell them apart.

---

### Stage 7 — Metrics, factors, agents · as demanded

Governed metric layer (Cube Core) so agents select metrics rather than writing SQL. `factor_edge` — a *separate* edge type from `link_type`, carrying `method` (`declared|regression|backtest|dowhy_gcm`), `confidence`, and `n_observations`, because a link is a database fact and a factor is an empirical claim. Start every edge as `declared`/`low`; backtest against real store performance; only introduce causal estimation past ~150–200 outcome-labelled stores, and say the limitation out loud in the product. An MCP server generated from `action_type`. **Agents get a menu, never a keyboard** — read through the governed layer, write only via `propose_action → validate → apply`, landing in the same audit row as a UI click.

---

## 6. What stays code, forever

Config sprawl is the standard failure mode of this architecture — a config file that is really a programming language, with none of the tooling. Draw the line now:

| Stays **code** | Becomes **config** |
|---|---|
| The kernel itself | Object types, properties, links, interfaces |
| Connector implementations | Which datasource backs which object type |
| Complex computation — scoring, budget rollups, SLA math (registered as `function_ref`) | Which function an action calls, and when |
| Genuinely bespoke UI (maps, the landing page, dashboards) | Standard object views, forms, queues, approval screens |
| Migrations | The schema those migrations are generated from |
| Auth, session, rate limiting | Which role and module an action requires |

When a rule needs a loop or more than three levels of nesting, it is a `function_ref`. Say so in the config so it is visible, rather than growing the expression language.

---

## 7. Risks worth naming

| Risk | Where it bites | Mitigation |
|---|---|---|
| **Registry indirection with no forcing function** | You build the tables and keep hardcoding anyway — paying for both | The Stage 1 exit test is non-negotiable. Do not start Stage 2 until a new object type has shipped config-only |
| **Generic query API as a footgun** | Stage 1. An open filter/aggregate endpoint is a data-leak and a table-scan waiting to happen | Policy compiler ships *with* the endpoint, not after; hard row caps, query timeouts, per-tenant cost budget from day one |
| **JSONB creep** | Overlay properties never get promoted; queries slow; the planner gives up | `props` gets a GIN index; promote to a real generated column the moment a client filters on it hot. No EAV table, ever |
| **The 20 hand-written modules never migrate** | Stages 3–5. You end up maintaining the kernel *and* 20 legacy slices | Budget a module-retirement quota per stage. A module is retired when its folder is deleted, not when a config exists alongside it |
| **Scoping logic scattered across 29 service modules** | Every read path. Today no single function answers "may this caller see this row?" | The policy compiler in Stage 1 becomes the only authority; per-route filters are deleted, not left as belt-and-braces |
| **Stale findings propagating between docs** | Three vault docs and the V2 roadmap still warn about `require_scope()`, which no longer exists | Every claim in this document was checked against the code on 2026-08-02. Re-verify before acting on anything older |
| **Client credentials** | Stage 6, the moment you hold read access to a client's POS/ERP | Vault-only secrets and per-tenant egress allowlist before the first connection, not after |
| **Overselling auto-mapping** | First client ERP with thousands of tables and no FK constraints | "We propose a model in an hour that you confirm in an hour" — never "we build your app automatically" |
| **The vertical wall** | A client in a genuinely different domain wants in | Say no, or fork the base package. Do not generalise the kernel to win one deal |
| **DPDP compliance** | The moment you hold a second client's commercial and employee data | Lawyer before client #2, not after |
| **Blue Tokai goes dark** | Throughout | Stages 0–2 are invisible to them by construction. Keep shipping V1 fixes — your only paying design partner should not feel a rebuild |

---

## 8. Decisions needed before Stage 1

These fork the design and are cheap now, expensive later.

1. **Base package scope.** Which object types are *the product* (every client gets them) versus overlay? My recommendation: Site, Agreement, DueDiligence, Budget, Review, Approval, Document, Launch. Everything else is overlay.
2. **Overlay authority.** Can a client's overlay *remove* a base property or only add and rename? Recommend add + rename only — removal breaks your own apps.
3. **Where do apps run?** In-process modules, or separate services calling the SDK over HTTP? Recommend in-process for yours, HTTP-only for third parties, with the same SDK surface.
4. **Object identity across datasources.** When the same store exists in your Postgres and a client's ERP, which is authoritative and how is it keyed? Decide before Stage 1's `datasource_binding` schema is written.
5. **Ontology editing UX.** YAML in git (reviewable, versionable) versus an admin UI. Recommend git-first through Stage 4, UI in Stage 5 — and the UI edits YAML, never rows.
6. **Pricing shape.** Per-tenant, per-object, per-seat? This determines whether `ontology_version` needs usage metering, which is much cheaper to add now than to retrofit.

---

## 9. Sources

Every repo claim in this document was verified against the working tree on 2026-08-02, not carried over from the superseded docs — two of which repeat findings that are no longer true.

**Code:** `backend/app/domain/state_machine.py` · `services/workflow_unlocks.py` · `services/_common.py:79` · `services/design_service.py:229` (`_assert_design_unlocked`) · `services/financial_closure_service.py:57` (`_assert_launched`) · `services/audit_service.py` · `services/notification_service.py` · `rbac/{roles,guards,permissions}.py` · `db/models.py` · `database/{schema,verified}.sql` + 52 migrations · `backend/tests/` (42 modules) · `frontend/src/modules/` (20 folders) · `frontend/src/services/api/`.

**Palantir Foundry architecture** (accessed August 2026):

- [Ontology overview and architecture](https://www.palantir.com/docs/foundry/object-backend/overview) — Object Storage V2, Object Data Funnel, writeback
- [Ontology core concepts](https://www.palantir.com/docs/foundry/ontology/core-concepts)
- [Object and link types](https://www.palantir.com/docs/foundry/object-link-types/type-reference)
- [Action types](https://www.palantir.com/docs/foundry/action-types/overview) — parameters, rules, submission criteria, side effects
- [Interfaces](https://www.palantir.com/docs/foundry/interfaces/interface-overview) and [implementing an interface](https://www.palantir.com/docs/foundry/interfaces/implement-interface)
- [Object security policies](https://www.palantir.com/docs/foundry/object-permissioning/object-security-policies) — row- and column-level security on the object type, independent of the datasource
- [Multi-datasource object types](https://www.palantir.com/docs/foundry/object-permissioning/multi-datasource-objects)
- [Virtual tables](https://www.palantir.com/docs/foundry/data-integration/virtual-tables) — query external tables in place, no copy
- [Ontology SDK (OSDK)](https://www.palantir.com/docs/foundry/ontology-sdk/overview) and [TypeScript OSDK](https://www.palantir.com/docs/foundry/ontology-sdk/typescript-osdk)
- [Marketplace: install a product](https://www.palantir.com/docs/foundry/marketplace/install-product) and [adding Ontology types to a product](https://www.palantir.com/docs/foundry/object-link-types/marketplace-ontology-types) — the API-name-prefix install model
- [Ontology branching](https://www.palantir.com/docs/foundry/ontologies/branching-ontology)

**Libraries referenced:** [panzi-json-logic](https://github.com/panzi/panzi-json-logic) (Python JsonLogic; no release in 12+ months — vendor or reimplement).
