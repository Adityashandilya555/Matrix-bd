# Build sequence — ordered by your requirements, not by generic staging

**Companion to:** [`Palantir_Evaluation.md`](./Palantir_Evaluation.md) · **Supersedes the ordering in** `Matrix_V3_Platform_Path.md` §5, not its content

---

## What changed and why

V3 sequences by architectural layer: kill schema drift → build the kernel → rules as data → interfaces → packaging. That order is defensible, but it buries the thing you actually asked for — **editable approval flows** — behind a full LinkML codegen effort. On a solo timeline that means months before anything demonstrates the core promise.

The PoC in [`poc/`](./poc/) shows the flow-editability work runs **directly against the existing `sites` table** with no codegen, no LinkML, and no schema change beyond one `props` column. So it moves earlier.

**What does not move:** Stage 0's drift-killing still comes first for anything *generated*. Three schema sources disagreeing 30/29/24 will poison a registry compiled from them. The distinction is that the registry can be *authored* by hand before it is *generated* from LinkML.

---

## Stage A — Prove it on one gate · ~2 weeks

**Goal:** one real approval gate reads from the registry in production, and nothing else changes.

1. Add the `ontology` schema — `ontology_version`, `object_type`, `property_def`, `link_type`, `action_type`, `datasource_binding`. The PoC's [`sql/02_registry.sql`](./poc/sql/02_registry.sql) is the starting DDL.
2. Author the base package **by hand** for `Site`, `LegalDD`, `SiteBudget`. No LinkML yet.
3. Port `_assert_design_unlocked` (`design_service.py:229`) to a JsonLogic `preconditions` row, and have the service call a generic gate evaluator instead of its inline `if`.
4. **Ship the fail-closed guard with it, not after.** A malformed rule row must raise, never permit — see `Palantir_Evaluation.md` §6 for the failure this prevents. Add a CI check validating every `preconditions` row before publish.

> **Exit test:** flipping the design gate in production is an `UPDATE`, not a deploy — and a deliberately corrupted rule row fails the request rather than opening the gate.

**Why first:** it is the smallest change that makes requirement #3 real, and it touches one function.

---

## Stage B — The policy compiler · ~3 weeks

**Goal:** exactly one function answers "may this caller see this row?"

Today `restrict_to_site_ids` and its siblings are threaded through 29 services. Collapse them into one predicate builder — tenant + role + module membership + delegation → a SQL predicate injected by the resolver. The PoC's `resolver.query_objects()` shows the shape, including the **fail-closed** branch: a tenant-scoped object type refuses to be queried without a tenant.

> **Exit test:** an executive's query returns only their delegated sites *because of the policy compiler*, not a router-level filter. Per-route filters are **deleted**, not left as belt-and-braces.

**Why second, before anything external:** this is breach-class, and every later stage — the generic API, the app layer, third-party SDKs, agents — is unshippable without it. It is also the one item on this list that is worth doing even if the platform vision is abandoned entirely.

---

## Stage C — Kill the drift · ~3 weeks

Now the generated path. Reflect the live schema; diff against `schema.sql`, `verified.sql`, and `models.py`; resolve each of the eight discrepancies explicitly. Author `ontology/base/matrix.linkml.yaml` as a faithful transcription. Generate DDL, SQLAlchemy models, Pydantic schemas, TS types. Wire `make check-drift` into CI. Delete `verified.sql`.

> **Exit test:** zero behavioural change; all 43 test modules green; CI fails on drift.

**Note:** LinkML also emits OWL and SHACL from the same file for free. Take them as build artifacts; do not build anything on them yet.

---

## Stage D — Properties and links as data · ~4 weeks

Requirements #4 and #5. Add the `props` JSONB column with a GIN index. Serve `display_name` from `property_def` so a tenant overlay renames without a migration. Declare `link_type` rows over the FKs that already exist, and route traversals through the generic resolver.

Promote a `props` key to a real generated column the moment a tenant filters on it hot. **No EAV table, ever.**

> **Exit test:** a tenant overlay renames `Site` → `Outlet` and adds one property, and the UI reflects both with no deploy. Proven in `poc/` proof 4.

---

## Stage E — Datasource binding · ~6 weeks

Requirement #2. Implement `datasource_binding` for real: `kind='native'` first, with `column_map` and `value_map`. Build the mapping-review screen — every proposed object type, property, and source column shown with sample values for one-click accept/edit/reject.

Copy Foundry's patterns: auto-map every column then prune; render `null` rather than erroring when a caller lacks permission on a source.

Do **not** promise row-wise unions across a client's databases — Foundry does not support them either.

> **Exit test:** one external Postgres connected, profiled, mapped, and serving the base `Site` object type. Proven in miniature in `poc/` proof 2.

---

## Stage F — Interfaces and packaging · ~8 weeks

Requirement #7, and the commercial milestone.

Extract `Approvable`, `Delegatable`, `Documented`, `Budgeted` from the machinery you already have — the approval logic duplicated across `design_service.py`, `legal_service.py`, `launch_service.py`; `delegation_service.py`; `site_documents_service.py`; `budget_service.py`. Bind them by declaration.

Then packaging: base package + client overlay, versioned, installed per tenant with display-name overrides. Stamp `ontology_version_id` on records. Copy Marketplace's **API-name consistency** rule — an installed package must create resources under the same api_names as the source, or nothing built on it survives an install.

Budget a **module-retirement quota**: a module is retired when its folder is deleted, not when a config exists alongside it.

> **Exit test:** ship a new object type — `SiteInsurancePolicy`, implementing `Approvable` + `Documented` — using only config and generated code. If it needs one hand-written router or service function, this stage is not done.

---

## Stage G — Model suggestion · when a deal needs it

Requirement #6, correctly ranked last by you. Introspect → profile columns → derive link candidates from FKs → match against the **fixed** base ontology → propose a mapping with sample values for confirmation.

Two rules, both learned from Foundry's limits and the schema-matching literature:
- **Never let a model decide cardinality.** Naming and descriptions only.
- **Position it as "we propose a model in an hour that you confirm in an hour"** — never "we build your app automatically."

The asset that makes this work: a repository of prior accepted mappings. Store every confirmed mapping from day one of Stage E, even before this stage is built — it is the training signal, and it is free to collect now and impossible to reconstruct later.

---

## Sequence at a glance

| Stage | Delivers | Weeks | Gate |
|---|---|---|---|
| A | req. #3 — editable gates | 2 | flipping a gate is an UPDATE; corrupt rule fails closed |
| B | row-level security | 3 | one authority; per-route filters deleted |
| C | one schema truth | 3 | zero behaviour change; CI fails on drift |
| D | req. #4, #5 — rename/add/links | 4 | overlay renames + adds, no deploy |
| E | req. #2 — client databases | 6 | one external DB serving base `Site` |
| F | req. #7 — interfaces, packaging | 8 | new object type, config only |
| G | req. #6 — model suggestion | — | when a signed deal asks |

**Cumulative to Stage F: ~26 focused weeks**, and that assumes uninterrupted time you do not have while shipping V1 fixes to Blue Tokai. Treat it as ordering, not as a schedule.

---

## The one non-negotiable

Stages A and B are worth doing **even if the platform vision is shelved**. A is a small, contained improvement to a gate you already maintain. B closes a real security gap that exists right now, in production, regardless of any of this.

Everything from C onward is a bet on the platform thesis. Nothing before it is.
