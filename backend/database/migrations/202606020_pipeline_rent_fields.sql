-- 202606020 — pipeline rent/map fields on sites
--
-- The ORM and API already write these site-level fields when a pipeline is
-- created. Some deployed databases are missing the columns, which makes
-- MG + Revenue Share creation fail at insert time. Keep this migration
-- idempotent so it can be applied safely to environments that already have
-- part of the shape.

ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS google_maps_url text,
    ADD COLUMN IF NOT EXISTS expected_rent numeric(12, 2),
    ADD COLUMN IF NOT EXISTS rent_type text,
    ADD COLUMN IF NOT EXISTS expected_escalation_pct numeric(6, 2),
    ADD COLUMN IF NOT EXISTS expected_escalation_years integer,
    ADD COLUMN IF NOT EXISTS expected_revshare_pct numeric(6, 2),
    ADD COLUMN IF NOT EXISTS rent_set_at timestamptz;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_sites_rent_type'
          AND conrelid = 'public.sites'::regclass
    ) THEN
        ALTER TABLE public.sites
            ADD CONSTRAINT chk_sites_rent_type
            CHECK (rent_type IN ('fixed', 'revshare', 'mg_revshare') OR rent_type IS NULL);
    END IF;
END $$;
