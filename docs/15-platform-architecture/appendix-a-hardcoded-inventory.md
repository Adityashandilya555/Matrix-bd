# Appendix A: Inventory of hardcoded and domain-specific assumptions

[← Index](README.md) · supports §3 and §4

This is the evidence behind §3. Each entry gives the assumption, where it lives, and the platform primitive that replaces it. Line numbers are navigation aids as of the commit this document was written against (`f528aa5`); if they drift, search for the named symbol instead.

Counts were produced with `grep` over `backend/app`, `frontend/src` (excluding `__tests__`) and `backend/database`.

---

## A1. Lifecycle and stages (H1, H3)

| # | Assumption | Location | Replaced by |
| --- | --- | --- | --- |
| A1.1 | The BD lifecycle is an 11-value enum with a fixed transition table | `backend/app/domain/state_machine.py:11-45` | Workflow definition |
| A1.2 | The same FSM is copied by hand into the frontend ("Mirrors frontend src/lib/stateMachine.js exactly") | `frontend/src/lib/stateMachine.js:1-34`; header of `state_machine.py:1-5` | Server is authoritative; the client renders allowed actions from metadata |
| A1.3 | Legacy UI stage names are mapped to statuses on the client | `frontend/src/lib/stateMachine.js` (`LEGACY_STAGE_MAP`) | View definitions |
| A1.4 | 14 per-stage timestamp columns on `sites` (`draft_submitted_at`, `shortlisted_at`, `details_submitted_at`, `approved_at`, `loi_uploaded_at`, `pushed_to_payments_at`, `rejected_at`, `archived_at`, `legal_review_at`, `legal_approved_at`, `legal_rejected_at`, `design_approved_at`, `project_completed_at`, `launched_at`) | `backend/database/schema.sql:107-138`; `backend/app/db/models.py:132-189` | Milestone events in the ledger; durations from events |
| A1.5 | 9 mirror columns on `sites` (`legal_dd_status`, `agreement_status`, `licensing_status`, `design_status`, `project_status`, `project_excellence_status`, `financial_closure_status`, `finance_status`, `is_launched`) | `backend/app/db/models.py:145-176` | `entities.lifecycle` projection |
| A1.6 | Per-module stage vocabularies as CHECK constraints: design `recce,2d,3d,boq,gfc,done`; project `budget,execution,done`; NSO `stage_one…final,done`; launch 6-state FSM | `backend/database/schema.sql:617-618, 672-673, 772-773, 836-841` | Stages of sub-flows |
| A1.7 | Design stage order and the "needs admin" set are Python constants | `backend/app/services/design_service.py:78-82` (`_KIND_ORDER`, `_NEXT_STAGE`, `_NEEDS_ADMIN`) | Flow graph + template conditions |
| A1.8 | Design stage order is re-declared in the UI | `frontend/src/modules/design/DesignQueuePage.jsx:34` (`STAGE_ORDER`) | Stage catalogue from metadata |
| A1.9 | Pipeline node list is declared twice in the UI and once more as backend logic | `frontend/src/modules/bd/site-tracker/SiteTrackerDetailPage.jsx:10-19`; `frontend/src/modules/business-admin/sites/SitesTab.jsx:112-121`; `backend/app/services/site_stage_status_service.py` (`_legal_state`, `_nso_stage_value`, …) | Lifecycle projection + stage tracker component |

## A2. Cross-module ordering (H2)

| # | Assumption | Location | Replaced by |
| --- | --- | --- | --- |
| A2.1 | Design opens only when `legal_dd_status='positive' AND finance_status='approved'` | `backend/app/services/workflow_unlocks.py:25-29` | Parallel join on milestones |
| A2.2 | The same gate is re-asserted inside Design | `backend/app/services/design_service.py:230` (`_assert_design_unlocked`) | Engine: the task only exists when the gate passed |
| A2.3 | Project opens when `design_status='approved'` | `backend/app/services/project_service.py:67-68` (+ queries at `:375, :434, :502`) | Flow edge |
| A2.4 | Project Excellence opens when `design_status='approved'` | `backend/app/services/project_excellence_service.py:57` (+ `:252`) | Flow edge |
| A2.5 | Financial Closure opens when `is_launched` | `backend/app/services/financial_closure_service.py:57-61` | Flow edge |
| A2.6 | Finance tab opens for `status ∈ {loi_uploaded, legal_review, legal_approved, pushed_to_payments}` | `backend/app/services/finance_service.py:36-38` (`_LOI_AND_BEYOND`) | Milestone condition `loi.uploaded` |
| A2.7 | Unlocking Design also advances the BD FSM to `pushed_to_payments` (a retired module's name) | `backend/app/services/workflow_unlocks.py:62-69` | Removed |
| A2.8 | Launch is created as a side effect of NSO final approval | `backend/app/services/launch_service.py:20-22` (docstring: "Called from nso_service.svc_final_approval") | Flow edge |

## A3. Departments as an enumeration (H4)

| # | Assumption | Location |
| --- | --- | --- |
| A3.1 | `_VALID_MODULES` (includes retired `payment`) | `backend/app/services/delegation_service.py:255` |
| A3.2 | `_VALID_MODULES` (second copy) | `backend/app/services/business_admin_service.py:40` |
| A3.3 | `_ORG_MODULES` | `backend/app/services/business_admin_service.py:1029` |
| A3.4 | `_MODULES` ("the page renders one row per module in this order") | `backend/app/services/module_access_service.py:32-34` |
| A3.5 | `Module = Literal[…]` | `backend/app/domain/schemas/business_admin.py:10`; `backend/app/domain/schemas/supervisor_codes.py:9` |
| A3.6 | `chk_site_delegations_module` (8 values incl. `quality_audit`) | `backend/app/db/models.py:443` |
| A3.7 | `WORKSPACE_MODULES` ("must stay in step with … Module literal") | `frontend/src/modules/shared/workspaceModules.js:12-19` |
| A3.8 | Module lists in CHECK constraints across **13 migrations** | `202605263_module_codes_table`, `202605264_supervisor_invite_codes_table`, `202605265_user_module_memberships_table`, `202605271_site_delegations`, `202606033_project_execution_foundation`, `20260609_nso_module`, `202606132_retire_payment_module`, `202606134_project_excellence_module`, `202606142_widen_module_checks_project_excellence`, `202606147_financial_closure_delegation`, `202606231_supervisor_executive_requests`, `20260805_qa_module_site_delegation`, `20260930_supervisor_module_access_grants` |
| A3.9 | Route guards: 42 `RequireModule` usages | `frontend/src/router/AppRouter.jsx` |
| A3.10 | ~60 module-specific route constants | `frontend/src/router/routes.js:2-61` |

*Every new department today means editing all of the above.* **Replaced by:** org units (§7) + installed packages (§15) + workspaces (§13.3).

## A4. Roles and authority (H5, H11)

| # | Assumption | Location | Replaced by |
| --- | --- | --- | --- |
| A4.1 | Four global roles | `backend/app/rbac/roles.py:29-33`; `users.role` CHECK (`schema.sql:68-69`) | Role templates → tenant roles |
| A4.2 | `role_in_module IN ('supervisor','executive')` | `schema.sql:470` | Roles on memberships |
| A4.3 | `stage_events.actor_role IN ('business_admin','supervisor','executive','system')` | `schema.sql:305-307` | Actor + membership in event envelope |
| A4.4 | 159 `Role.X` references and 93 raw role-string comparisons in backend and frontend | `grep` counts | Policies |
| A4.5 | Admin and observer bypass every guard (`READ_ALL_ROLES`) | `backend/app/rbac/roles.py:43-46`; `guards.py:22-33, 82-88` | Observer = SEE-only role; admin capabilities explicit |
| A4.6 | Duplicated action→role maps that have drifted | `backend/app/rbac/permissions.py:10-36` vs `frontend/src/rbac/permissions.js:5-24` | Server-computed allowed actions |
| A4.7 | One module per session (JWT claim; `ORDER BY module … LIMIT 1`) | `backend/app/services/auth_repo.py:89-107` | Identity-only tokens; acting-as |
| A4.8 | Role and module rewritten by request headers | `backend/app/core/deps.py:124-190` (`_apply_workspace_override`) | Impersonation and acting-as with provenance |
| A4.9 | "Supervisor-tier" is a hardcoded predicate | `backend/app/services/_common.py:121-128` (`actor_can_supervise`) | Capability `…:approve@scope` |
| A4.10 | Executive object scope = `submitted_by` or `assigned_to` | `backend/app/services/_common.py:131-141` | Derived roles (`owner`, `assignee`) in policy |

## A5. Approval ladder (H6)

| # | Implementation | Location |
| --- | --- | --- |
| A5.1 | `approvals` table + `details_submitted → approved` | `schema.sql:336-356`; `bd_service.py` |
| A5.2 | `finance_status: pending → awaiting_supervisor → awaiting_admin → approved` | `finance_service.py:1-6, 40`; `models.py:174-176` |
| A5.3 | Legal DD `stage` + `final_verdict` | `schema.sql:528-550` |
| A5.4 | `legal_change_requests` | `schema.sql:583-610` |
| A5.5 | Design deliverable `status` + `admin_status`, `gfc_status` | `schema.sql:617-662` |
| A5.6 | Budgets `draft → pending_supervisor → pending_admin → approved/rejected` | `schema.sql:737-738`; `models.py:901` |
| A5.7 | Project milestone and QA statuses (incl. `supervisor_approved`) | `schema.sql:684-700`; `models.py:783-826` |
| A5.8 | NSO `final_approval_signoff_1/2` | `models.py:967-968` |
| A5.9 | Launch validation loop (6 states, plus a superseded legacy ladder kept in columns) | `schema.sql:834-868`; `launch_service.py:1-23` |

**Replaced by:** approval task kind + approval policy + `maker_checker_approver` fragment (§11).

## A6. The site is the only case type (H7)

- `site_id uuid NOT NULL` appears in **19** table definitions in the reference schema (`grep "site_id +uuid NOT NULL" schema.sql`).
- History and notifications are site-keyed: `audit_logs.site_id`, `stage_events.site_id NOT NULL`, `notification_outbox.site_id`, `reversible_actions.site_id NOT NULL`.
- Lock helper names: `fetch_site_or_404`, `fetch_site_for_update_or_404` (`_common.py:75-104`).
- **Replaced by:** `subject` references to any entity type (§6, §14).

## A7. Forms and checklists as schema (H8)

| # | Assumption | Location |
| --- | --- | --- |
| A7.1 | Legal DD items are 9 columns + 2 free-label slots | `schema.sql:528-550`; `models.py:481-…` |
| A7.2 | Licences are 5 columns (`fssai`, `health_trade`, `shops_estab_reg`, `fire_noc`, `storage_license`) | `schema.sql:568-581` |
| A7.3 | NSO readiness flags are columns (`fssai_status`, `dry_stock_order_status`, `online_delivery_status`, …) | `schema.sql:769-802` |
| A7.4 | Budget has exactly 11 named heads | `backend/app/services/budget_service.py:28-40`; `schema.sql:761` (`CHECK (idx BETWEEN 1 AND 11)`) |
| A7.5 | Audited "pipeline fields" are a fixed tuple | `backend/app/services/audit_service.py:87` (`PIPELINE_FIELDS`) |
| A7.6 | Launch's editable commercial snapshot duplicates ~20 site fields | `schema.sql:807-833` |

**Replaced by:** JSON Schema forms with item lists as data (§17), with diffs from the ledger (§14).

## A8. Tenant-specific facts in shared code and schema (H9)

| # | Assumption | Location |
| --- | --- | --- |
| A8.1 | Site display codes are prefixed `BT-` (Blue Tokai) for every tenant | `backend/app/services/_common.py:46-50` (`make_site_code`) |
| A8.2 | Competitor distance columns `nearest_starbucks_m`, `nearest_twc_m` | `schema.sql:190-191`; `models.py:225-226` |
| A8.3 | Store `model` values such as "BTC Cafe+" | `schema.sql:92` |
| A8.4 | Demo identity `demo@bluetokai.local` | `backend/app/core/deps.py:22-30` |
| A8.5 | Rent types `fixed, revshare, mg_revshare, staggered` and a staggered-escalation validator as a DB function | `schema.sql:15-47, 154-156` |

**Replaced by:** tenant settings + package settings (`code_prefix`, `competitor_brands`) + entity schema (§6.4, §15.1).

## A9. Jurisdiction-specific facts (H10)

| # | Assumption | Location |
| --- | --- | --- |
| A9.1 | 18% GST hardcoded in total operating cost | `backend/app/services/_common.py:211` (`* 1.18`) |
| A9.2 | Indian licences (FSSAI, Shops & Establishment, Health/Trade) across backend and frontend (17 files mention `fssai`) | `schema.sql:568-581, 778-782`; `grep -rl fssai` |
| A9.3 | Rupee formatting with `en-IN` in ~30 frontend files; rupee icon in navigation | e.g. `frontend/src/modules/shared/rent/RentScheduleDialog.jsx:21`; `Sidebar.jsx:275` |

**Replaced by:** tenant locale and currency settings; jurisdiction-specific checklists and decision tables inside packages (§15). The café-launch flow adds RERA, showing that jurisdiction content varies even within one country.

## A10. Notifications and history wired per transition (H13, H14)

| # | Assumption | Location |
| --- | --- | --- |
| A10.1 | Recipient resolvers per module, called at 55 sites in services and routers | `backend/app/services/notification_service.py:43-120`; `grep recipients_for_` |
| A10.2 | 97 distinct free-text audit `action` strings | `grep -rhoE 'action="[a-z_]+"'` |
| A10.3 | Writes under a borrowed grant are indistinguishable in the audit trail | `backend/database/migrations/20260930_supervisor_module_access_grants.sql` ("Out of scope" note) |
| A10.4 | Undo needs a separate snapshot table because the audit log lacks before-state | `schema.sql:259-285` |
| A10.5 | A module-specific timeline table for Launch | `schema.sql:877-897` |

**Replaced by:** notification rules + one ledger with a provenance envelope (§14).

## A11. Retired concepts still in the core (H15)

- `PUSHED_TO_PAYMENTS` status (`state_machine.py:22, 44, 48`) and `pushed_to_payments_at` (`schema.sql:112`), still written by `workflow_unlocks.py:62-69`.
- `payment` in `_VALID_MODULES` (`delegation_service.py:255`, `business_admin_service.py:40`) and in `module_codes` CHECK (`schema.sql:418`).
- `ROUTES.PAYMENT` (`frontend/src/router/routes.js:27`) and the `payment` key in `SitesTab.jsx:115`.
- Legacy launch ladder columns (`schema.sql:860-868`).
