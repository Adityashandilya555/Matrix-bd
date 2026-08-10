# Matrix-BD V2 — Execution Roadmap
**From:** a hand-built BD ops app for one tenant (Blue Tokai)
**To:** a config-driven ontology platform for retail expansion — sellable to any multi-store chain (coffee, QSR, F&B, retail) without a code change per customer.

This roadmap turns the ingestion/ontology/Foundry-pattern research (the "six decisions" doc you shared) into a sequence you can actually execute against the real repo. Every step below cites the actual file, table, or line it touches. Nothing here is executed yet — this is the plan for review.

---

## 0. Where you actually stand today

I read the live codebase, not just the docs, before writing this. Ground truth:

| Layer | Reality | File(s) |
|---|---|---|
| Object types | 24 hardcoded tables: `tenants`, `users`, `sites`, `site_details`, `audit_logs`, `stage_events`, `approvals`, `site_files`, `notification_outbox`, `shortlist_delegations`, `site_delegations`, `legal_dd_checklist`, `site_agreement`, `site_licensing`, `legal_change_requests`, `design_reviews`, `design_deliverables`, `project_reviews`, `quality_audit_reports`, `site_budgets`, `site_budget_items`, `nso_reviews`, `launch_approvals`, `launch_review_events` | `backend/app/db/models.py` (1,127 lines) |
| Schema truth | Split across two files that can drift | `backend/database/schema.sql` (841 lines) vs `backend/database/verified.sql` (673 lines) vs `models.py` — three sources of truth for the same 24 tables, plus 52 migration files layered on top | `backend/database/migrations/` (52 files) |
| Action type | Real, and well-built: every state change goes `assert_transition → mutate → audit_service.write_audit_event → notification_service`. This is your moat — most Foundry clones never get this right. | `backend/app/domain/state_machine.py`, `backend/app/services/*_service.py` |
| Cross-module gates | Hardcoded Python conditionals, e.g. design unlocks only when `site.legal_dd_status == 'positive' AND site.finance_status == 'approved'` | `backend/app/services/design_service.py:229-243` (`_assert_design_unlocked`), `backend/app/services/workflow_unlocks.py` |
| Roles | Clean 3-role model — `business_admin`, `supervisor`, `executive` — with orthogonal module membership (BD, Legal, Payments…), not baked into the role itself | `backend/app/rbac/roles.py`, `backend/app/rbac/permissions.py`, `backend/app/rbac/guards.py` |
| Frontend | 20 hand-built module folders, one per business domain, each with its own screens, hooks, API calls | `frontend/src/modules/{bd,legal,design,project,nso,launch,payment,financial_closure,project_excellence,loi,admin,business-admin,team,staging,archive,...}` |
| Known gaps | `require_scope()` is a stub that 500s if called (SEC-02); `verified.sql` vs `models.py` drift is undocumented in code, only in your own review | `CODEBASE_REVIEW.md` §10-11 |

**The diagnosis, stated plainly:** every one of your 24 object types, every link between them, and every unlock rule exists only as Python control flow. Adding a new object type — say, "Franchisee Agreement" for a QSR chain, or renaming `Site` to `Outlet` for a client who calls it that — means a migration, a model class, a service file, a router, and a React module. That is the entire cost structure this roadmap exists to fix.

**What must not change:** the Action runtime pattern (`assert_transition → mutate → audit → notify`), the RBAC model, and the audit ledger (`stage_events`, `audit_logs`). These are correct. V2 makes their *inputs* — which object types exist, which properties they have, which links connect them — data instead of code.

---

## 1. Target end-state (what "done" looks like)

Five primitives, declared in YAML (LinkML), compiled into a Postgres-backed registry your existing FastAPI runtime reads at request time:

- **Object type** — e.g. `Site` (or `Outlet`, `Restaurant`, `Kiosk` for a different vertical) — schema for a real-world entity.
- **Property** — a typed column or JSONB path on an object type, with display name, unit, sensitivity.
- **Link type** — a declared relationship (`Site —has→ LegalChecklist`), backed by a real FK or join.
- **Action type** — the declared shape of a state change: parameters, validation rules, RBAC requirement, side effects. Your `_assert_design_unlocked`-style functions become *data* a generic engine reads, not code you rewrite per tenant.
- **Interface** — a shape multiple object types can implement (`Approvable`, `Delegatable`, `Documented`, `Budgeted`). This is the mechanism that makes a second vertical (a QSR chain with "Outlets" instead of "Sites") a config job instead of a fork.

Storage stays Postgres. Core, always-present properties stay real typed columns (fast, indexed, constrained). Tenant- or vertical-specific extensions (e.g. a food chain's `franchise_royalty_pct`, a fashion retailer's `mall_zone_tier`) live in one `props jsonb` column per table with a GIN index, promoted to a real generated column only when a tenant queries it hot. No generic EAV table — it would defeat the query planner and your Action validations.

---

## 2. Build sequence

### Phase 0 — Kill the drift (2 weeks)

**Goal:** one source of truth. No new features, no behavior change.

1. Introspect the live schema with SQLAlchemy reflection + diff it against `backend/database/schema.sql` and `verified.sql`. Produce a diff report — this alone will surface real bugs (columns in one file, not the other).
2. Install LinkML (Apache 2.0). Author one `matrix.linkml.yaml` describing today's 24 tables exactly as they exist — no redesign yet, just a faithful transcription of `models.py`.
3. Generate from that one file: SQL DDL (replaces `schema.sql`/`verified.sql`), SQLAlchemy models (replaces the hand-written classes in `models.py`), Pydantic schemas (replaces the 20 hand-written files in `backend/app/domain/schemas/`), TypeScript types for the frontend.
4. Wire codegen into `Makefile` / CI so `schema.sql`, `models.py`, and the Pydantic schemas can never drift again — they're all generated artifacts of the LinkML file.
5. Do **not** touch `migrations/` yet. Migrations keep working against the generated DDL; LinkML is the new design surface, migrations are still the deploy mechanism.

**Exit test:** `git diff` shows zero behavioral change in any router or service; the app boots and every existing test in `backend/tests/` still passes.

### Phase 1 — Registry + interfaces (4 weeks)

**Goal:** make object types, links, and actions *data*, and prove it with one real feature built entirely in config.

1. Add four tables to the schema: `object_type`, `property_def`, `link_type`, `action_type` (see the research doc §3.4 for exact columns), scoped by `tenant_id`.
2. Migrate three existing types to be *described by* the registry rather than hardcoded: `Site` (`sites`+`site_details`), `LegalDD` (`legal_dd_checklist`), `SiteBudget` (`site_budgets`+`site_budget_items`). Pick these three because they already exercise every pattern you have: state machine, checklist, and line-item budget.
3. Extract interfaces from your existing generic machinery and rebind it:
   - `Approvable` → binds to `approvals` table + the approval logic currently duplicated across `design_service.py`, `legal_service.py`, `launch_service.py`.
   - `Delegatable` → binds to `delegation_service.py`, `shortlist_delegations`, `site_delegations`.
   - `Documented` → binds to `site_documents_service.py`, `storage_service.py`, `site_files`.
   - `Budgeted` → binds to `budget_service.py`, `site_budgets`.
4. Rewrite the hardcoded unlock gate in `design_service.py:229-243` and `workflow_unlocks.py` as a declared `action_type` validation rule (`design.open` requires `legal_dd_status == positive AND finance_status == approved`) read by a generic gate-checker, not a Python `if`.
5. Replace `require_scope()`'s `NotImplementedError` stub (`rbac/guards.py`) with a real implementation that checks against the new `action_type.required_role` / `required_module` columns — you need this working before agents or dynamic actions can be trusted.

**Success test (from the research doc, keep it as the literal gate):** add one *new* object type — e.g. `SiteInsurancePolicy`, implementing `Approvable` + `Documented` — using **only** registry config and generated code. If it requires touching a router or writing a new service function by hand, Phase 1 isn't done. Do not proceed to Phase 2 until this passes.

### Phase 2 — Ingestion + mapping (4 weeks)

**Goal:** connect an external database (a customer's POS, ERP, or franchise system) and get a reviewed, working object type out the other end.

1. Embed **dlt** (Apache 2.0) as a library inside the FastAPI process — no separate service to operate. Do not use Airbyte (ELv2 license is a gray zone for your embedded multi-tenant model — see research doc §4.2).
2. Add the connector framework: `connection`, `source_schema_snapshot`, `ingest_run` tables, plus a `landing.<tenant>_<connection>_<table>` schema for raw, append-only data. Credentials go in Supabase Vault or KMS — never a plain column.
3. Ship two source kinds first: **Postgres/MySQL via SQLAlchemy** and **file upload** (the XLSX a BD lead already emails you — this is your existing `site_files` upload path, generalized). Add Oracle only when a customer signs and asks.
4. Build the mapping pipeline: introspect → profile columns → derive link-type candidates from foreign keys → run LinkML Schema Automator to draft a schema → LLM pass for naming/descriptions only (never let it decide cardinality) → a mapping review screen where every proposed object type, property, and source column is shown with sample values for one-click accept/edit/reject.
5. Commit accepted mappings to the Phase 1 registry tables. This is the same registry, same generated code path — ingestion doesn't get a separate storage model.

**Guardrail:** never auto-commit a schema proposal. The mapping review screen is mandatory, and it doubles as your best demo asset — "we point at your ERP and propose a model in an hour" is a real, honest claim; "we build your app automatically" is not.

### Phase 3 — Factors + agent (4 weeks)

**Goal:** the retail-expansion-specific differentiator — a declared driver tree, plus one agent capability on top of it.

1. Add `factor_edge` (research doc §6.2): a third, distinct edge type from links — `from_ref`, `to_ref`, `direction`, `weight`, `method` (`declared | regression | dowhy_gcm | backtest`), `confidence`, `n_observations`. This is separate from `link_type` on purpose — a link is a database fact, a factor is an empirical claim that must carry its own uncertainty.
2. Sit with the BD team (or the design-partner chain's team once you have one) and encode the driver tree they already carry in their heads — carpet area → seating capacity → covers → monthly sales; frontage → walk-in rate; rent as % of projected sales → viability — as `method='declared', confidence='low'` edges. Render as an interactive graph. This is sellable on its own before any statistics run.
3. As sites/outlets launch and get real financials, backtest declared edges against actuals and adjust confidence. Do not claim causal inference yet — this is calibration only.
4. Generate an MCP server from the `action_type` registry — new object type, new tools, automatically, with zero hand-written glue.
5. Agents get read access through a governed semantic layer (Cube Core, Apache 2.0, compile-time row-level security) and write access only via `propose_action → your existing validate → mutate → audit → notify path`. Same audit row as a UI click. **Agents get a menu, never a keyboard.**
6. Only past ~150-200 outcome-labelled stores across your customer base, introduce DoWhy (MIT) for actual causal contribution estimates. Say this limitation out loud in the product — a driver tree that's honest about `declared` vs `dowhy_gcm` provenance is more trustworthy than one that hides it, and it's the detail that survives a CFO's scrutiny.

### Phase 4 — Enterprise answers (build only when a signed deal needs it)

Not speculative work — each of these is a response to a specific objection you'll hit selling into larger chains:

- **Ontop** (Apache 2.0) — read-only virtual RDF view over a customer's live Oracle/SAP, for the prospect who says "we're not copying our ERP into your Supabase."
- **Debezium + LogMiner** (never XStream — it requires an Oracle GoldenGate license) — sub-minute freshness, when polling isn't enough.
- **OpenMetadata** (Apache 2.0) — lineage/catalog, once you have enough tenants that "where did this number come from" needs its own UI.

---

## 3. Why this specifically serves "expand into food chains with many stores"

This is the part worth being explicit about, since it's your stated goal:

- **Vertical-agnostic naming.** Once `Site` is registry-defined rather than hardcoded, a food-chain customer can have `object_type.display_name = "Outlet"` (or "Restaurant," "Kiosk," "Branch") over the identical underlying structure and Action runtime. You are not maintaining a second codebase per vertical — you're maintaining one engine and N YAML files.
- **Interfaces carry the expensive-to-build parts across verticals for free.** Delegation, approvals, document handling, and audit are the genuinely hard, well-tested parts of your current app. Binding them to `Approvable`/`Delegatable`/`Documented` interfaces instead of to `Site` specifically is what lets a new food-chain object type — `FranchiseAgreement`, `KitchenEquipmentInventory`, whatever the vertical needs — inherit all of it by declaring `implements: [Approvable, Documented]`.
- **The factor layer is your actual product wedge for scale customers.** A chain with 200+ stores cares less about "can you store my data" and more about "why is this location underperforming the cluster median." That's Phase 3, and it only becomes crediblewith the declared → backtest → causal sequencing in §6.3 of the research doc — skipping straight to "AI-powered predictions" on 40 outcome-labelled sites will get caught by the first person who checks your math.
- **Ingestion is what turns "one tenant, hand-onboarded" into "sign a chain, connect their POS/ERP in a day."** Phase 2's mapping-review flow is the actual sales motion for a multi-store chain — most of them already have a POS or ERP with the store roster in it; you shouldn't be asking them to re-enter 200 stores by hand.

---

## 4. Risks that actually matter (carried forward from the research doc, sharpened against your repo)

| Risk | Where it bites | Mitigation |
|---|---|---|
| Registry indirection without a forcing function | Easy to build `object_type`/`property_def` tables and keep hardcoding anyway, paying for both | The Phase 1 "new object type via config only" test is non-negotiable — do not start Phase 2 until it passes |
| Auto-mapping oversold | First real customer ERP with thousands of tables and no FK constraints | Position it as "proposes a model in an hour you confirm in an hour," never "fully automatic" |
| Fake causality | Phase 3 factor layer, credibility with any CFO-level buyer | Every `factor_edge` carries `method` + `confidence`; never hide `declared` behind a confident-looking number |
| Customer credentials | Phase 2, the moment you hold read access to a customer's POS/ERP | Vault-only secrets, per-tenant egress allowlist, before the first connection — not after |
| `require_scope()` is a live 500 risk today | `backend/app/rbac/guards.py` | Fix in Phase 1 step 5, before any dynamic action-type work depends on it |
| Solo-founder bandwidth | Phases 0-3 are ~14 focused weeks; you're also interning | Blue Tokai should keep getting V1 fixes throughout — do not go dark on your only paying design partner while rebuilding the foundation |
| India DPDP compliance | The moment you ingest a second tenant's employee/commercial data | Lawyer conversation before tenant #2, not after |

---

## 5. Condensed checklist

| Phase | Duration | Exit test |
|---|---|---|
| 0 — Kill the drift | 2 wks | `schema.sql`, `models.py`, Pydantic schemas all generated from one LinkML file; zero behavior change |
| 1 — Registry + interfaces | 4 wks | New object type shipped using only config + generated code, no hand-written router/service |
| 2 — Ingestion + mapping | 4 wks | One external Postgres/MySQL source connected, profiled, mapped, and committed to the registry via the review UI |
| 3 — Factors + agent | 4 wks | Interactive driver tree live for one real vertical; MCP server auto-generated from action-type registry; one agent Q&A capability answered by walking the factor graph |
| 4 — Enterprise | as demanded | Each item ships against a signed deal requirement, not speculatively |

See `Matrix_System_Architecture.html` for the visual version of the target-state system.
