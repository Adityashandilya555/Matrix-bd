-- 202607081 — Add area_sqft to sites + staggered rent type
--
-- Feature: capture sqft at pipeline-creation and introduce a fourth rent type
-- "staggered" (Staggered Rent with Escalation).
--
-- area_sqft lives on the sites row (pipeline stage); the pre-existing
-- site_details.carpet_area_sqft serves the Add Details form. At pipeline
-- creation the user enters area_sqft; the Add Details page can pre-fill
-- carpet_area_sqft from it.
--
-- staggered_escalation is a JSONB array of {year, percent} objects stored on
-- the sites row. DB-level constraints enforce ≤5 entries, positive years,
-- and percent within 0-100.

BEGIN;

-- 1. New column: area_sqft (pipeline-stage sqft)
ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS area_sqft integer NOT NULL DEFAULT 0;

ALTER TABLE public.sites
    DROP CONSTRAINT IF EXISTS chk_area_sqft_positive;
ALTER TABLE public.sites
    ADD CONSTRAINT chk_area_sqft_positive CHECK (area_sqft >= 0);

-- 2. New column: staggered_escalation (JSONB schedule)
ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS staggered_escalation jsonb;

ALTER TABLE public.sites
    DROP CONSTRAINT IF EXISTS chk_staggered_escalation;
ALTER TABLE public.sites
    ADD CONSTRAINT chk_staggered_escalation CHECK (
        (staggered_escalation IS NULL) OR (
            jsonb_typeof(staggered_escalation) = 'array'
            AND jsonb_array_length(staggered_escalation) <= 5
            AND NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(staggered_escalation) AS e
                WHERE (e->>'year')::int <= 0
                   OR (e->>'percent')::float < 0
                   OR (e->>'percent')::float > 100
            )
        )
    );

-- 3. Widen rent_type CHECK to include 'staggered'
ALTER TABLE public.sites
    DROP CONSTRAINT IF EXISTS chk_sites_rent_type;
ALTER TABLE public.sites
    ADD CONSTRAINT chk_sites_rent_type
    CHECK (rent_type IN ('fixed', 'revshare', 'mg_revshare', 'staggered') OR rent_type IS NULL);

-- Also widen the site_details rent_type check if it exists
DO $$
BEGIN
    ALTER TABLE public.site_details DROP CONSTRAINT IF EXISTS chk_site_details_rent_type;
    ALTER TABLE public.site_details
        ADD CONSTRAINT chk_site_details_rent_type
        CHECK (rent_type IN ('fixed', 'revshare', 'mg_revshare', 'staggered') OR rent_type IS NULL);
EXCEPTION
    WHEN undefined_table THEN NULL;
END $$;

COMMIT;
