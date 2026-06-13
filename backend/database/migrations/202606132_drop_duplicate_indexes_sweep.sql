-- 202606132 — Drop the rest of the duplicate-index class found by the
-- DB↔code cross-check (sibling of #133 / 202606131).
--
-- CONTEXT:
--   A whole-DB scan of pg_indexes (grouping by normalized indexdef) found three
--   more tables carrying a plain btree index that EXACTLY shadows a UNIQUE
--   index on the same column(s). Two were created redundantly by their own
--   original migration (a UNIQUE constraint AND a separate CREATE INDEX on the
--   same columns); one is out-of-band:
--
--     table            redundant index               shadows (kept)                       origin
--     launch_approvals idx_launch_approvals_site_id  launch_approvals_site_id_key (UNIQUE) 202606094:31+89
--     module_codes     idx_module_codes_tenant_module module_codes_tenant_id_module_key (UNIQUE) 202605263:17+20
--     site_details     idx_site_details_site          site_details_site_id_key (UNIQUE)    out-of-band (no migration)
--
-- SAFETY (confirmed across FastAPI + frontend before keeping these dropped):
--   * The surviving UNIQUE index has the IDENTICAL column set/order, and a
--     UNIQUE btree is fully usable for reads (equality, range, sort) — so no
--     query loses its access path.
--   * FastAPI only ever filters these columns by equality
--     (LaunchApproval.site_id ==, module_codes WHERE tenant_id/module,
--     SiteDetail.site_id ==) — all served by the surviving UNIQUE index.
--   * No application code (backend or frontend) references an index by name;
--     indexes are a pure storage-layer concern.
--
-- NOTE: the redundant CREATE INDEX lines remain in 202605263 / 202606094 (we do
--   not rewrite already-applied migrations). On a fresh rebuild they create the
--   duplicate and this migration drops it again — net end-state is correct.
--
-- DDL is idempotent.

DROP INDEX IF EXISTS public.idx_launch_approvals_site_id;
DROP INDEX IF EXISTS public.idx_module_codes_tenant_module;
DROP INDEX IF EXISTS public.idx_site_details_site;
