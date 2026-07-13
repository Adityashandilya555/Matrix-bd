-- 20260713_add_na_to_legal_checklists.sql
-- Add 'na' (Not Applicable) to the legal checklist value CHECK constraints.
--
-- Both the DD checklist (legal_dd_checklist) and the licensing checklist
-- (site_licensing) previously allowed only 'pending'/'yes'/'no' per item.
-- 'na' lets a reviewer mark an item that does not apply to a site (e.g. a
-- storage licence for a model that stores nothing). A license marked 'na'
-- counts as resolved for the licensing rollup, exactly like 'yes'.
--
-- Constraints on the live DB are per-column, auto-named <table>_<column>_check
-- (created inline by 202605268_legal_workflow_tables.sql), not the combined
-- ORM names — verified against pg_constraint before writing this migration.
-- This change is purely additive (widens the allowed set); no data is touched.

BEGIN;

-- ── site_licensing (5 statutory licences) ─────────────────────────────────────
ALTER TABLE public.site_licensing DROP CONSTRAINT IF EXISTS site_licensing_fssai_check;
ALTER TABLE public.site_licensing ADD  CONSTRAINT site_licensing_fssai_check
    CHECK (fssai IN ('pending','yes','no','na'));

ALTER TABLE public.site_licensing DROP CONSTRAINT IF EXISTS site_licensing_health_trade_check;
ALTER TABLE public.site_licensing ADD  CONSTRAINT site_licensing_health_trade_check
    CHECK (health_trade IN ('pending','yes','no','na'));

ALTER TABLE public.site_licensing DROP CONSTRAINT IF EXISTS site_licensing_shops_estab_reg_check;
ALTER TABLE public.site_licensing ADD  CONSTRAINT site_licensing_shops_estab_reg_check
    CHECK (shops_estab_reg IN ('pending','yes','no','na'));

ALTER TABLE public.site_licensing DROP CONSTRAINT IF EXISTS site_licensing_fire_noc_check;
ALTER TABLE public.site_licensing ADD  CONSTRAINT site_licensing_fire_noc_check
    CHECK (fire_noc IN ('pending','yes','no','na'));

ALTER TABLE public.site_licensing DROP CONSTRAINT IF EXISTS site_licensing_storage_license_check;
ALTER TABLE public.site_licensing ADD  CONSTRAINT site_licensing_storage_license_check
    CHECK (storage_license IN ('pending','yes','no','na'));

-- ── legal_dd_checklist (9 due-diligence items) ────────────────────────────────
ALTER TABLE public.legal_dd_checklist DROP CONSTRAINT IF EXISTS legal_dd_checklist_title_doc_check;
ALTER TABLE public.legal_dd_checklist ADD  CONSTRAINT legal_dd_checklist_title_doc_check
    CHECK (title_doc IN ('pending','yes','no','na'));

ALTER TABLE public.legal_dd_checklist DROP CONSTRAINT IF EXISTS legal_dd_checklist_sanctioned_plan_check;
ALTER TABLE public.legal_dd_checklist ADD  CONSTRAINT legal_dd_checklist_sanctioned_plan_check
    CHECK (sanctioned_plan IN ('pending','yes','no','na'));

ALTER TABLE public.legal_dd_checklist DROP CONSTRAINT IF EXISTS legal_dd_checklist_oc_cc_check;
ALTER TABLE public.legal_dd_checklist ADD  CONSTRAINT legal_dd_checklist_oc_cc_check
    CHECK (oc_cc IN ('pending','yes','no','na'));

ALTER TABLE public.legal_dd_checklist DROP CONSTRAINT IF EXISTS legal_dd_checklist_commercial_use_check;
ALTER TABLE public.legal_dd_checklist ADD  CONSTRAINT legal_dd_checklist_commercial_use_check
    CHECK (commercial_use IN ('pending','yes','no','na'));

ALTER TABLE public.legal_dd_checklist DROP CONSTRAINT IF EXISTS legal_dd_checklist_property_tax_check;
ALTER TABLE public.legal_dd_checklist ADD  CONSTRAINT legal_dd_checklist_property_tax_check
    CHECK (property_tax IN ('pending','yes','no','na'));

ALTER TABLE public.legal_dd_checklist DROP CONSTRAINT IF EXISTS legal_dd_checklist_electricity_check;
ALTER TABLE public.legal_dd_checklist ADD  CONSTRAINT legal_dd_checklist_electricity_check
    CHECK (electricity IN ('pending','yes','no','na'));

ALTER TABLE public.legal_dd_checklist DROP CONSTRAINT IF EXISTS legal_dd_checklist_fire_noc_check;
ALTER TABLE public.legal_dd_checklist ADD  CONSTRAINT legal_dd_checklist_fire_noc_check
    CHECK (fire_noc IN ('pending','yes','no','na'));

ALTER TABLE public.legal_dd_checklist DROP CONSTRAINT IF EXISTS legal_dd_checklist_other_1_check;
ALTER TABLE public.legal_dd_checklist ADD  CONSTRAINT legal_dd_checklist_other_1_check
    CHECK (other_1 IN ('pending','yes','no','na'));

ALTER TABLE public.legal_dd_checklist DROP CONSTRAINT IF EXISTS legal_dd_checklist_other_2_check;
ALTER TABLE public.legal_dd_checklist ADD  CONSTRAINT legal_dd_checklist_other_2_check
    CHECK (other_2 IN ('pending','yes','no','na'));

COMMIT;
