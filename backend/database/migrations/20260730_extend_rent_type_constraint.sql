-- 20260730_extend_rent_type_constraint.sql
-- Extend rent_type CHECK constraint to include 'staggered'

BEGIN;

ALTER TABLE public.sites
    DROP CONSTRAINT IF EXISTS chk_sites_rent_type;

ALTER TABLE public.sites
    ADD CONSTRAINT chk_sites_rent_type
    CHECK (rent_type IN ('fixed', 'revshare', 'mg_revshare', 'staggered') OR rent_type IS NULL);

COMMIT;
