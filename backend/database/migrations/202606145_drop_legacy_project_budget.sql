-- Migration 202606145: drop the legacy project budget — DESTRUCTIVE, NOT YET APPLIED.
--
-- The old 10-box project budget (project_budget_items + the budget_* columns on
-- project_reviews) is fully superseded by the shared site_budgets (phase='gfc').
-- The merged ORM already stopped mapping these, so they sit unused. This migration
-- removes them once the new Project Excellence flow is verified working.
--
-- HOLD: run this only with explicit authorization — it deletes the 118 legacy
-- project_budget_items rows and the project_reviews budget summary columns.

ALTER TABLE public.project_reviews
    DROP CONSTRAINT IF EXISTS chk_project_budget_status,
    DROP COLUMN IF EXISTS budget_status,
    DROP COLUMN IF EXISTS budget_total,
    DROP COLUMN IF EXISTS total_indoor_area_sqft,
    DROP COLUMN IF EXISTS total_area_sqft,
    DROP COLUMN IF EXISTS covers,
    DROP COLUMN IF EXISTS budget_supervisor_comments,
    DROP COLUMN IF EXISTS budget_admin_comments;

DROP TABLE IF EXISTS public.project_budget_items;
