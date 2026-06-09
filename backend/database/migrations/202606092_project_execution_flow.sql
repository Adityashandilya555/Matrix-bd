-- 202606092 — Project execution flow rework.
--
-- ADDITIVE & BACKWARD-COMPATIBLE.
--   1. Init date is now proposed by the business-admin at final budget approval,
--      then accepted/rejected by the executive → allow a 'proposed' init status.
--   2. Supervisor sets a mid-project visit date after expected completion.
--   3. On quality-audit approval the site is completed and pushed to NSO →
--      nso_status / pushed_to_nso_at handoff columns (consumed by the parallel
--      NSO module via nso_status='pushed').
--
-- Existing rows keep initialization_status in its current value, nso_status
-- defaults to 'pending', and the new date columns are NULL — no live session or
-- the demo breaks. Quality-audit report files reuse site_files
-- (file_type='quality_audit'); site_files.file_type is free text, so no change
-- is needed there.
--
-- Apply BEFORE deploying the backend code that reads/writes these columns.

BEGIN;

-- 1. Allow the executive-negotiated 'proposed' initialization status.
ALTER TABLE public.project_reviews
    DROP CONSTRAINT IF EXISTS chk_project_initialization_status;
ALTER TABLE public.project_reviews
    ADD CONSTRAINT chk_project_initialization_status
    CHECK (initialization_status IN ('pending','proposed','submitted','approved','rejected'));

-- 2. Supervisor's mid-project visit date.
ALTER TABLE public.project_reviews
    ADD COLUMN IF NOT EXISTS mid_project_visit_date date;

-- 3. NSO handoff.
ALTER TABLE public.project_reviews
    ADD COLUMN IF NOT EXISTS nso_status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.project_reviews
    ADD COLUMN IF NOT EXISTS pushed_to_nso_at timestamp with time zone;
ALTER TABLE public.project_reviews
    DROP CONSTRAINT IF EXISTS chk_project_nso_status;
ALTER TABLE public.project_reviews
    ADD CONSTRAINT chk_project_nso_status CHECK (nso_status IN ('pending','pushed'));

COMMIT;
