-- 20260801 — Widen sites.area_sqft from integer to numeric (allow decimals)
-- (authored 2026-07-14)
--
-- area_sqft was `integer NOT NULL DEFAULT 0`, so fractional square footage
-- entered at New Pipeline / Add Details (e.g. 1120.50) was silently truncated
-- to a whole number. Every sibling area column (site_details.carpet_area_sqft,
-- nso_reviews.total_area_sqft, …) is already numeric, so this aligns the
-- pipeline column with them.
--
-- Widen in place: existing whole-number values cast losslessly to numeric, the
-- DEFAULT 0 stays valid, and chk_area_sqft_positive (area_sqft >= 0) needs no
-- change. Guarded so a re-run (or a manual apply) is a no-op once converted.
--
-- NOTE: the startup migration runner executes each statement in its own
-- transaction and strips bare BEGIN;/COMMIT;. It only recognises `$$` for
-- dollar-quote detection, so the guard block below uses `$$`.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name  = 'sites'
          AND column_name = 'area_sqft'
          AND data_type   = 'integer'
    ) THEN
        ALTER TABLE public.sites
            ALTER COLUMN area_sqft TYPE numeric(12, 2) USING area_sqft::numeric;
    END IF;
END $$;

-- Re-assert the default so it is stored as a numeric literal, not the old int.
ALTER TABLE public.sites
    ALTER COLUMN area_sqft SET DEFAULT 0;
