-- 20260819 — Rent start date on site_details + launch_approvals
-- (authored 2026-09-10)
--
-- ADDITIVE. The launch validation loop gains a rent commencement date. It is
-- captured DURING the loop rather than in the LOI "Add Details" form: the site
-- creator fills it at under_exec_review (the only field they may edit), the
-- supervisor and admin may correct it, and svc_admin_final_confirm REQUIRES it
-- before committing — so a launched site always carries a rent start date.
--
-- The staging column on launch_approvals mirrors site_details exactly, the same
-- way escalation_date already does (migration 202606094): seeded from the site
-- detail on create, edited via PATCH /launch-approvals/{id}/rent-fields, and
-- written back by _commit_rent_to_canonical at final confirm.
--
-- The five other commercial fields this work makes editable (carpet_area_sqft,
-- cam_charges, capex, security_deposit, brokerage) already exist on BOTH tables
-- and need no DDL — only the editable allow-list and the commit function change.
--
-- Sorts after 20260818 (multi-supervisor executives). BEGIN;/COMMIT; are
-- stripped by the startup runner; kept for parity.

BEGIN;

ALTER TABLE public.site_details
    ADD COLUMN IF NOT EXISTS rent_start_date date;

ALTER TABLE public.launch_approvals
    ADD COLUMN IF NOT EXISTS rent_start_date date;

COMMIT;
