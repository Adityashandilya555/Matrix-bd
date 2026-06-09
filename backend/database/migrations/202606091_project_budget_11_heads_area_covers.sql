-- 202606091 — Project budget: 11 investment heads + area / cover inputs.
--
-- ADDITIVE & BACKWARD-COMPATIBLE.
--   1. Relaxes the budget line-item check from 1..10 to 1..11 so the new
--      11-head investment list (Professional Fees … Misc) can be saved. The
--      old 10-head data stays valid (idx 1..10 is a subset of 1..11).
--   2. Adds nullable area / cover columns to project_reviews. They travel with
--      the budget save/submit and feed the per-sqft / per-cover metrics. NULL
--      on every existing row, so no live session or the demo breaks.
--
-- Apply BEFORE deploying the backend code that sends idx=11 and reads/writes
-- the new columns (Pydantic now allows idx<=11; svc_save_budget persists area
-- / covers). The live Railway backend still runs the old code until deploy and
-- will simply never send idx=11 / leave the new columns NULL — safe either way.

BEGIN;

-- 1. Allow an 11th budget line item.
ALTER TABLE public.project_budget_items
    DROP CONSTRAINT IF EXISTS chk_project_budget_idx;
ALTER TABLE public.project_budget_items
    ADD CONSTRAINT chk_project_budget_idx CHECK (idx BETWEEN 1 AND 11);

-- 2. Area / cover inputs captured with the budget (drive the calculated
--    per-sqft / per-cover read-outs on the Estimated Budget form).
ALTER TABLE public.project_reviews
    ADD COLUMN IF NOT EXISTS total_indoor_area_sqft numeric(12,2);
ALTER TABLE public.project_reviews
    ADD COLUMN IF NOT EXISTS total_area_sqft        numeric(12,2);
ALTER TABLE public.project_reviews
    ADD COLUMN IF NOT EXISTS covers                 integer;

COMMIT;
