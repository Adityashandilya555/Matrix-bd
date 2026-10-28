# Part 3: Open-source evaluation

[← Index](README.md) · §19 Evaluation · §20 Recommended components · §21 What to build internally

> Facts below were checked in October 2026 against project sites, release notes and licence texts (sources at the end). Star counts and versions change; licences are the facts that matter most and were verified individually.

---

## §19 Open-source project evaluation

### 19.1 The question asked of every candidate

Not "which repository has the most features?" but:

> **Can this become a reliable foundational subsystem *inside* our architecture?**

Each candidate was scored on these criteria, in priority order:

1. **Licence fit for a multi-tenant commercial SaaS.** OSI-approved and permissive, or weak copyleft used as a library. AGPL, source-available and "fair-code" licences are disqualifying for core subsystems.
2. **Does it solve a hard problem we should not build?** Examples: correct BPMN token semantics, migration of running instances, policy query planning.
3. **Can it sit behind a port?** It must be replaceable without rewriting the product.
4. **Data compatibility.** Runs on PostgreSQL and doesn't require owning our data model.
5. **Operational cost** for a small team building alongside a live product.
6. **Longevity:** governance, maintainer diversity, release cadence, licence-change history.
7. **Multi-tenancy, versioning and migration support.**
8. **Extensibility, embedding and API quality.**

### 19.2 Workflow / process engines

| Criterion | **Operaton** | **SpiffWorkflow / SpiffArena** | **Flowable OSS** | **CIB seven** | **Camunda 8** | **Temporal** | **DBOS Transact** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Licence | Apache-2.0 | LGPL-3.0 | Apache-2.0 | Apache-2.0 | Camunda License v1 (source-available); **production needs a commercial licence** since 8.6 | MIT | MIT |
| Stack | Java 17+ / Spring Boot 4 (2.0) | Python library; Arena = Flask + React | Java / Spring | Java (Camunda 7 fork) | Java/Go, Zeebe + Elasticsearch/OpenSearch | Go server, Python SDK | Python library |
| Standard | BPMN 2.0, DMN 1.3 (Camunda 7.24 API-compatible) | BPMN 2.0, DMN | BPMN, CMMN, DMN | BPMN, DMN | BPMN, DMN | Code-as-workflow | Code-as-workflow |
| Task status / claim / complete | Built in (user tasks, external tasks) | Built in (Arena) | Built in | Built in | Built in | — (build) | — (build) |
| Accept / reject → next | Gateways | Gateways | Gateways | Gateways | Gateways | Code | Code |
| Delegation | `delegateTask`, candidate users/groups | Lanes; Arena permissions | Built in | Built in | Built in | — | — |
| Rules | DMN decision tables, also evaluable standalone over REST | DMN + Python scripts | DMN | DMN | DMN (FEEL) | Code | Code |
| Forms | Camunda Forms / embedded (we won't use) | JSON Schema + RJSF (Arena) | Form engine | Camunda Forms | Camunda Forms | — | — |
| Flow altered | BPMN redeploy (versioned automatically) | BPMN redeploy; models in git | Redeploy | Redeploy | Redeploy | Code deploy + patching | Code deploy |
| **Running instances follow new flow** | **MigrationPlan API**: activity mapping, validation, batch | **Limited automatic migration**: only if changed tasks not yet executed; not for multi-instance, loops, call activities | Migration API | Migration API (C7) | Migration API | Patching / worker versioning (code) | Code versioning |
| Multi-tenancy | Tenant IDs on deployments, instances and jobs | Process groups (no tenant model) | Tenant IDs | Tenant IDs | Tenants (Identity) | Namespaces | DB-level |
| Embedding | Embedded (JVM) or remote REST | **In-process Python**, state is JSON we persist | Embedded/REST | Embedded/REST | Remote only | Remote cluster | In-process |
| Persistence | Own schema (PostgreSQL supported) | **Our tables** (serialized state) | Own schema | Own schema | Own (RocksDB + exporters) | Own cluster | Our Postgres |
| Community / health | Active fork after C7 CE EOL (Oct 2025); 2.0 released Mar 2026; 2.2 planned Oct 2026; foundation forming | Small (Sartography + GSA fork); steady releases (Sep 2026) | Mature; OSS UI apps removed in v7 | Company-backed (CIB, 20+ devs) | Large, but licence-gated | Very large | Growing fast |
| **Verdict** | **Adopt (default)** | **Fallback adapter; spike** | Viable alternative to Operaton | Viable alternative (vendor support) | Avoid (licence) | Avoid as process engine; possible automation runtime | **Trial** for automations |

#### Corrections to the comparison table you shared

| Row | Shared table said | Correction |
| --- | --- | --- |
| SpiffArena · running sites follow new flow | "Manual" | Arena has **in-product instance migration**, but only when the added, updated or deleted tasks have not yet executed. It is blocked for multi-instance, loops, active call activities and signal boundary changes. Stronger than "manual"; weaker than Operaton's MigrationPlan. |
| Operaton · forms | "Camunda Forms (JSON)" | Correct, but irrelevant to us. Forms are a platform concern (§17). The engine never renders UI. |
| Frappe · delegation | "Assignment rules" | Frappe assigns by fixed role per transition, and the Frappe issue tracker has long-standing requests for dynamic assignment and delegation. Assignment rules exist for ToDo allocation, not as policy-checked delegation. |
| Operaton · health | "476★" | Stars understate it: it is API-compatible with a decade of Camunda 7 production use and docs, with a 2.x line in 2026. |

#### Operaton: why it is the default

- **It solves the hardest problems correctly:** BPMN token semantics (parallel/inclusive joins, boundary timers for SLA escalation, compensation, call activities with version binding), **process-instance migration** and **standalone DMN evaluation**. These are years of work to build and get right.
- **Apache-2.0 under community governance.** It was forked precisely because Camunda 7 CE reached end of life and Camunda 8 moved to a commercial production licence. That is the licence-change risk we want to avoid.
- **It fits the job-worker pattern (§10.6).** External tasks mean our Python worker does all human, system and AI work, and the engine only coordinates. Community Python clients for the Camunda 7 external-task REST API work against Operaton because the API is compatible, and the API is small enough to call directly with `httpx`.
- **Costs:**
  - A JVM service (~0.5–1 GB RAM) and its own schema in Postgres.
  - Java knowledge for ops, but no custom Java code if we stick to external tasks and REST.
  - Dual state between engine and platform, mitigated by outbox/inbox and idempotency (§22.4).

#### SpiffWorkflow: the serious alternative

- **Strengths:**
  - Pure Python, embedded in-process.
  - Workflow state is serialized JSON stored **in our own tables, in the same transaction as entity writes and ledger events**, so there is no dual state.
  - No JVM.
  - DMN supported. Arena uses JSON Schema + RJSF, the same form stack we chose.
- **Weaknesses:**
  - Small community.
  - LGPL. Fine as an unmodified library; modifications to the library itself must be shared.
  - Weaker instance migration.
  - Timers and background progression are the host application's job.
  - Performance with large serialized states is less proven.
- **Decision rule for the Phase 0 spike (§29).** Run the Blue Tokai *and* café-launch flows on both engines through the same `WorkflowPort`. Measure four things:
  1. Migration coverage for the v1→v2 example (§16.3).
  2. Correctness of parallel join + send-back loops + SLA timers.
  3. Ops footprint.
  4. Developer ergonomics.
- **Choosing.** If SpiffWorkflow covers migration well enough for real changes, its single-transaction simplicity may win for a small team. Otherwise Operaton.

#### Why not Temporal (or DBOS) as the process engine

They make *code* durable, which is excellent, but here the workflow must be **data an admin edits**. Using them would mean writing our own BPMN-like interpreter on top, which is the reinvention the brief rules out. They are useful for **automations and integrations** (§20), where the steps really are code: "push to ERP, retry for 3 days, then open a task".

### 19.3 Application and low-code platforms (as candidate foundations)

| Criterion | **Frappe** | **NocoBase** | **Odoo CE** | **Twenty** | **Directus** | Appsmith / ToolJet / Budibase |
| --- | --- | --- | --- | --- | --- | --- |
| Licence | MIT | **Apache-2.0** (changed from AGPL-3.0 on 26 Feb 2026) | LGPL-3.0 (Enterprise proprietary) | AGPL-3.0 | BSL 1.1 (not OSI) | Apache-2.0 / AGPL-3.0 / GPL-3.0 |
| Stack | Python + MariaDB (Postgres secondary) + Vue/jQuery desk | Node/TypeScript (Koa) + React/AntD/Formily | Python + PostgreSQL + OWL | TypeScript/NestJS + React + Postgres | Node | Node/JS |
| Data model | DocType → table per type (runtime DDL) | Collections → tables (runtime DDL); data-model-driven, UI decoupled | Models → tables (module install DDL) | Custom objects; schema per workspace | Wraps any SQL schema | Bring your own |
| Workflow | Single-document state machine; no parallel joins; no definition versions; changes apply to in-flight docs by state name | Event-triggered workflows with parallel branches, conditions, manual and approval nodes | Per-model states + server actions | Trigger → action automations | Flows (automation) | Basic |
| Permissions | Role permissions + user permissions + permission query conditions | Roles + data scopes + field permissions | Groups + record rules | Roles | Roles + field/item rules | App-level |
| Packages | **Apps** (hooks, fixtures, patches) — strongest | **Microkernel plugins**; everything is a plugin | **Modules** with manifest, `depends`, inheritance, migrations | Apps (emerging) | Extensions | — |
| Multi-tenancy | Site per tenant (DB per site); single-DB multi-tenancy is a community effort | Multi-app manager (app per tenant) | DB per tenant | Workspace per schema | Instance per tenant | — |
| **Verdict** | **Reference** (apps, fixtures); not foundation | **Reference architecture**; foundation only if a Node rewrite is acceptable | **Reference** (module manifest, inheritance, upgrades) | **Reference** (metadata API, views as data); AGPL blocks embedding | Avoid (licence) | Avoid (internal-tool builders) |

#### Should Frappe be the foundation? No.

Frappe gives the most for free: DocTypes, forms, list views, permissions, workflow, audit "Version" docs, REST, apps and fixtures. It fails on the requirements the brief marks most important:

- **Workflow.** It is a state machine on one document, with no parallel joins (Legal ∥ Finance → Design is the *core* of today's flow) and no versioned definitions. In-flight documents follow edited workflows by state name, so the "sites already running" requirement is not met.
- **Ownership of the stack.** Adopting Frappe means its ORM, its Desk UI (not React or the Z-Matrix design system), MariaDB-first operations and DB-per-site tenancy. We would rebuild the product in Frappe's idiom *and* still need a real process engine.
- **What to take from it:** the app model (hooks, fixtures as data, patches as migrations) informs §15.

#### Should NocoBase be the foundation? Only if we choose to become a NocoBase solution.

NocoBase is the closest open-source system to the brief's vision:

- Data-model-driven design with collections decoupled from the UI.
- Schema-driven pages and blocks.
- Workflow with approvals and parallel branches.
- Roles with data scopes and field permissions.
- A microkernel where everything is a plugin.
- Apache-2.0 since February 2026, with formerly commercial plugins open-sourced.

Reasons not to build *on* it:

1. **It is a product, not a subsystem.** We would ship our product inside its admin UI paradigm (Ant Design, its block system) and its upgrade cadence. The customer-facing UX would be NocoBase's, not ours.
2. **Language and runtime switch** to Node/TypeScript, away from the Python team, the existing services and the strongest AI ecosystem.
3. **Tenancy is app-per-tenant** (sub-applications), not the row-level shared schema we operate today.
4. **Single-vendor licence control.** It moved from AGPL-3.0 to Apache-2.0 in February 2026 as part of a pricing and strategy pivot. That is favourable today, but it shows that one company controls the licence of the thing we would be built on.

**Use it as the reference implementation.** Study its plugin lifecycle, collection metadata, UI schema and workflow-version freezing during Phase 0. Re-open this decision only if the team decides on a TypeScript stack anyway.

### 19.4 Authorization / policy engines

| | **Cerbos** | **OpenFGA** | **SpiceDB** | **OPA** | **Cedar** | **Casbin** |
| --- | --- | --- | --- | --- | --- | --- |
| Licence | Apache-2.0 (Hub is commercial, optional) | Apache-2.0; **CNCF Incubating** (Oct 2025) | Apache-2.0 | Apache-2.0; CNCF Graduated | Apache-2.0 | Apache-2.0 |
| Model | RBAC + ABAC, derived roles, scoped policies | ReBAC (Zanzibar) + CEL conditions | ReBAC (most Zanzibar-faithful) | General policy (Rego) | RBAC + ABAC, schema-validated, formally verified | RBAC/ABAC models (library) |
| State | **Stateless**: we pass attributes | Stores relationship tuples (**dual write**) | Stores tuples (dual write) | Stateless (data pushed in) | Stateless | Stateless (policy store) |
| List filtering ("what can I see?") | **PlanResources → SQLAlchemy adapter** | ListObjects (IDs) | LookupResources (IDs) | Partial eval (complex) | Partial eval (experimental) | Manual |
| Per-tenant dynamic policies | **Scoped policies + Postgres store + Admin API** | Per-store models | Per-schema | Bundles | Policy sets | DB adapter |
| Python | SDK + `cerbos-sqlalchemy` | SDK | gRPC client | REST | `cedarpy` (community bindings) | `pycasbin` |
| Decision audit | Decision logs incl. matched policy | Changelog | Watch API | Decision logs | — | — |
| **Verdict** | **Adopt** | **Reserve** (deep sharing graphs) | Reserve (alternative to OpenFGA) | Avoid for app authz (Rego cost, filtering) | **Watch** (strong in-process alternative if partial eval matures) | Avoid (too thin for audit/filtering) |

**Why Cerbos wins here.** The hardest requirement in the brief is "can see data" on *lists and views*, not on single records. Cerbos's query plans compile to SQLAlchemy filters, and that is exactly the integration our view engine needs. Its scoped policies map one-to-one to "package defaults + tenant overrides". Relationships stay in our database, so there is no dual write.

### 19.5 Rules and expressions

| | Role | Verdict |
| --- | --- | --- |
| **DMN 1.3** (via engine; standalone REST evaluation) | Decision tables for routing, DoA, SLA classes, scoring | **Adopt.** A standard that is portable across engines |
| **JsonLogic** | Serialization of the condition AST (§10.5) | **Adopt** as a storage format (compiled to JUEL, SQL and CEL) |
| **CEL** | Policy conditions inside Cerbos (generated) | Adopt (implicitly, via Cerbos) |
| **GoRules ZEN** (MIT; Rust + Python binding; React JDM editor) | In-process decision tables outside workflows | **Trial** if in-process decisions are needed without an engine round-trip, or with the SpiffWorkflow path |

### 19.6 Forms and builder UIs

| | Licence | Verdict |
| --- | --- | --- |
| **react-jsonschema-form (RJSF)** | Apache-2.0 | **Adopt.** Mature, themeable, the same stack SpiffArena uses |
| JSON Forms (EclipseSource) | MIT | Alternative; comparable |
| Formily (Alibaba) | MIT | Powers NocoBase; heavier, React+AntD-centric |
| form-js (bpmn.io) | bpmn.io licence | Avoid (watermark, Camunda-centric) |
| SurveyJS | Library MIT, Creator commercial | Avoid (builder is paid) |
| **React Flow (@xyflow/react)** | MIT | **Adopt** for the Flow Graph canvas and module-graph view |
| bpmn-js | bpmn.io licence: **the watermark must stay visible** | Optional read-only "advanced view" for admins; not in customer-facing builders |
| JointJS+ | Commercial | Avoid |

### 19.7 AI orchestration

| | Licence | Role | Verdict |
| --- | --- | --- | --- |
| **LangGraph** | MIT | Stateful agent graphs; Postgres checkpointer; `interrupt` for human-in-the-loop | **Trial** in the AI layer only |
| LangChain | MIT | Model and tool adapters | Use selectively; avoid deep coupling |
| Anthropic SDK / Claude Agent SDK | Vendor SDK | Model access, tool runner, agent loop | Default model provider behind `AgentPort` |
| **MCP** (spec 2026-07-28; SDKs) | Open spec | Tool surface over the platform API; OAuth 2.1 resource-server model | **Adopt** for agent access |
| **pgvector** | PostgreSQL licence | Embeddings in our database | **Adopt** |
| LlamaIndex | MIT | Retrieval framework | Not needed initially |

### 19.8 Automation, analytics and infrastructure

| | Licence | Verdict |
| --- | --- | --- |
| **DBOS Transact** | MIT | **Trial** for durable automations: steps, retries and queues checkpointed in our Postgres, with no new server |
| Temporal | MIT | Alternative for automations if volume or complexity outgrows DBOS |
| n8n | Sustainable Use License (fair-code) | Avoid embedding (licence) |
| Windmill | AGPL-3.0 (core) | Avoid embedding |
| Kestra | Apache-2.0 | Possible data-pipeline runner later |
| **Cube (Core)** | Apache-2.0 | Later: semantic layer for KPIs |
| Superset | Apache-2.0 | Later: internal analytics |
| Metabase | AGPL-3.0 | Avoid embedding |

### 19.9 Should we replace the backend?

You said you are open to replacing it. These are the four honest options:

| Option | What it means | Verdict |
| --- | --- | --- |
| **A. New Python/FastAPI platform core** (+ Operaton/Cerbos as services) | Keep the language and the proven disciplines; rewrite the *design* around primitives | **Recommended** |
| B. Build on Frappe | Adopt Frappe's ORM, Desk and apps; add a real engine anyway | No: weaker workflow core, full stack swap |
| C. Build on NocoBase (Node/TS) | Adopt NocoBase's kernel and plugins; build our packages as NocoBase plugins | Only if a TypeScript stack and NocoBase's UX are acceptable |
| D. Java/Spring core with Operaton **embedded** | Engine and domain writes share one JVM transaction, so there is no dual state | Strong technically; rejected for team skills and the Python AI ecosystem. Revisit if dual-state handling proves painful in the spike |

"Replacing the backend" therefore means **a new platform codebase**. The current FastAPI app is the reference implementation to re-express as packages, not a base to extend. The stack's language is not the problem; the domain-shaped design is.

---

## §20 Recommended open-source components

| Subsystem | Component | Licence | Integration pattern | Exit strategy |
| --- | --- | --- | --- | --- |
| Primary datastore, entity store, ledger, vectors | **PostgreSQL** (Supabase) + **pgvector** | PostgreSQL | Native | Any managed Postgres |
| Workflow execution | **Operaton** (spike vs **SpiffWorkflow**) | Apache-2.0 / LGPL-3.0 | Internal service; BPMN/DMN deployed by compiler; **external-task job workers**; REST | `WorkflowPort`: Flowable, CIB seven, Camunda 7-compatible engines run the same BPMN |
| Decisions | **DMN** (engine), JsonLogic AST | — | Business-rule tasks; standalone DMN REST; native Python evaluator | DMN is a standard |
| Authorization | **Cerbos PDP** (+ `cerbos-sqlalchemy`) | Apache-2.0 | Sidecar; policies compiled from the permission matrix into the Postgres store | `PolicyPort`: Cedar (in-process) or OpenFGA for ReBAC-heavy resources |
| Forms | **JSON Schema 2020-12 + RJSF** | Apache-2.0 | Schema served by the metadata API; same schema validated in Python | JSON Forms renders the same schema |
| Builder canvas | **React Flow** | MIT | Studio component over Flow Graph JSON | Graph JSON is ours |
| Durable automation | **DBOS Transact** (trial) | MIT | Library inside the worker | `AutomationPort`: Temporal |
| AI | **LangGraph**, **MCP**, Claude via **Anthropic SDK** | MIT / open spec / vendor | AI layer only; agents are actors | `AgentPort`; MCP is provider-neutral |
| Object storage | **Supabase Storage** (S3-compatible) | — | Current `storage_service` pattern | Any S3 |
| Email/Slack | **Resend**, Slack webhooks | — | Outbox relay | Provider adapters |

---

## §21 What should be built internally

These are the product's core competence. No open-source project provides them in the shape we need, and they are what makes the platform *ours*:

| Build | Why it can't be bought |
| --- | --- |
| **Platform kernel** (tenants, actors, org units, memberships, entity store, relationships, documents) | The data shape *is* the product; every OSS candidate either owns it (Frappe, NocoBase) or ignores it (engines) |
| **Command pipeline** (authn → actor resolution → policy → validation → lock → apply → ledger → outbox) | The generalization of today's best discipline (§2.2); the single choke point for audit and security |
| **Event ledger** with provenance envelope | No OSS ledger records "which workflow version / policy / task" for *our* primitives |
| **Task service** (assignment, responsibilities, delegation, SLA projection, approval policies, inbox) | Must be engine-independent and actor-independent (human, AI) |
| **Flow Graph model + BPMN/DMN compiler + validator + simulator** | The business-level language is our UX; BPMN is the target, not the authoring model |
| **Definitions store, config releases, pinning, package manager, three-way merge** | No candidate offers tenant overlays on package bases with release semantics |
| **Policy compiler** (permission matrix → Cerbos) and field-group masking | The admin experience for "who can do what" |
| **View engine** (query AST → SQL ∧ policy plan; layouts; workspaces; metrics) | Role-derived views over one model are the brief's central idea |
| **Metadata-driven runtime shell + Studio** (wizard, builders, migration UI) | Customer-facing experience and the Z-Matrix design system |
| **v1 → v2 migration tooling** | Specific to our history |
| **Workflow, policy and agent adapters** (ports) | Thin, but they are what make the external components replaceable |

---

### Sources

- Operaton 2.0 release and roadmap: [operaton.org/2026/03/20/operaton-2-0-released](https://operaton.org/2026/03/20/operaton-2-0-released/) · [github.com/operaton/operaton](https://github.com/operaton/operaton) · migration docs: [docs.operaton.org … process-instance-migration](https://docs.operaton.org/docs/documentation/user-guide/process-engine/process-instance-migration/)
- Camunda 7 forks compared: [onlu.ch: Operaton vs CIB seven](https://onlu.ch/en/operaton-vs-cibseven-comparison-of-two-open-source-bpmn-engines-for-the-future-of-process-automation/) · [dev.to: Camunda 7 CE end of life options](https://dev.to/richard_bizik/camunda-7-ce-end-of-life-your-options-and-why-almost-all-of-them-are-the-same-engine-349o)
- Camunda 8 licensing: [camunda.com: Licensing update for Camunda 8 Self-Managed](https://camunda.com/blog/2024/04/licensing-update-camunda-8-self-managed/) · [docs.camunda.io/docs/reference/licenses](https://docs.camunda.io/docs/reference/licenses/)
- SpiffWorkflow licence and releases: [github.com/sartography/SpiffWorkflow/releases](https://github.com/sartography/SpiffWorkflow/releases) · [github.com/sartography/spiff-arena](https://github.com/sartography/spiff-arena) · instance migration: [spiff-arena.readthedocs.io … manage_processes](https://spiff-arena.readthedocs.io/en/latest/how_to_guides/manage_processes.html)
- Flowable OSS: [flowable.com/open-source](https://www.flowable.com/open-source) · [github.com/flowable/flowable-engine](https://github.com/flowable/flowable-engine)
- Temporal versioning and licence: [docs.temporal.io … python/workflows/versioning](https://docs.temporal.io/develop/python/workflows/versioning) · [pypi.org/project/temporalio](https://pypi.org/project/temporalio/)
- DBOS: [github.com/dbos-inc/dbos-transact-py](https://github.com/dbos-inc/dbos-transact-py) · [supabase.com/blog/durable-workflows-in-postgres-dbos](https://supabase.com/blog/durable-workflows-in-postgres-dbos)
- Frappe: [frappe.io/framework/features](https://frappe.io/framework/features) · workflow docs: [docs.frappe.io … workflows](https://docs.frappe.io/erpnext/user/manual/en/workflows) · delegation request: [frappe/frappe#7822](https://github.com/frappe/frappe/issues/7822) · single-DB multi-tenancy: [frappe/frappe#28019](https://github.com/frappe/frappe/issues/28019)
- NocoBase licence change: [nocobase.com/en/blog/v2.0.3](https://www.nocobase.com/en/blog/v2.0.3) · [nocobase.com/en/blog/pricing-adjustment-202602](https://www.nocobase.com/en/blog/pricing-adjustment-202602) · plugins: [docs.nocobase.com/plugin-development](https://docs.nocobase.com/plugin-development/)
- Twenty: [opensourcealternatives.to/item/twenty](https://www.opensourcealternatives.to/item/twenty) · [toolworthy.ai/tool/twenty](https://www.toolworthy.ai/tool/twenty)
- Cerbos: [cerbos.dev: multi-tenant scoped policies](https://www.cerbos.dev/blog/multi-tenant-saas-authorization-role-policies-and-scoped-resource-policies) · [docs.cerbos.dev … storage](https://docs.cerbos.dev/cerbos/latest/configuration/storage.html) · [github.com/cerbos/query-plan-adapters (sqlalchemy)](https://github.com/cerbos/query-plan-adapters/tree/main/sqlalchemy)
- OpenFGA CNCF incubation: [cncf.io/blog/2025/11/11/openfga-becomes-a-cncf-incubating-project](https://www.cncf.io/blog/2025/11/11/openfga-becomes-a-cncf-incubating-project/)
- Cedar Python bindings: [github.com/k9securityio/cedar-py](https://github.com/k9securityio/cedar-py)
- GoRules ZEN: [github.com/gorules/zen](https://github.com/gorules/zen)
- bpmn-js licence/watermark: [github.com/bpmn-io/bpmn-js/blob/develop/LICENSE](https://github.com/bpmn-io/bpmn-js/blob/develop/LICENSE) · [forum.bpmn.io: watermark](https://forum.bpmn.io/t/bpmn-js-license-watermark-doubt/11267)
- LangGraph HITL and checkpointers: [docs.langchain.com … interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts) · [docs.langchain.com … checkpointers](https://docs.langchain.com/oss/python/langgraph/checkpointers)
- MCP 2026-07-28 specification: [blog.modelcontextprotocol.io/posts/2026-07-28](https://blog.modelcontextprotocol.io/posts/2026-07-28/) · [modelcontextprotocol.io … authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization)
