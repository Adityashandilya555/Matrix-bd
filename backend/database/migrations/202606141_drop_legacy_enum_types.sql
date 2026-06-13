-- Retire five orphaned legacy Postgres ENUM types whose value sets no longer
-- match the values enforced by application code and CHECK constraints.
--
-- Background
-- ----------
-- When the codebase migrated status/role columns to plain `text` (with CHECK
-- constraints), only the column types in Python were updated.  The underlying
-- Postgres ENUM objects were never dropped.  This creates two live problems:
--
--   1. WRITE FAILURES: A column still typed as the old enum rejects any value
--      that was added to the application after the enum was defined.
--      Concretely, `stage_events.actor_role` is typed as `user_role` which
--      pre-dates the `business_admin` role — every audit event written by a
--      business-admin user crashes at the DB layer.
--
--   2. STALE CONSTRAINT: The enum enforces a value set that differs from the
--      CHECK constraints the application now relies on.  Tooling (pg_dump,
--      schema diffing, Supabase advisors) flags the drift as a defect.
--
-- Fix: for every column still typed as one of the five enums, ALTER it to
-- `text` (preserving all existing data via `USING col::text`), then add a
-- NOT VALID CHECK so new rows are validated without rejecting historical data,
-- then DROP the enum type.
--
-- Enums addressed
-- ---------------
--   site_status   →  sites.status
--                    stage_events.from_status  (open set — no CHECK added)
--                    stage_events.to_status    (open set — no CHECK added)
--
--   user_role     →  stage_events.actor_role
--                    (users.role already migrated to text + CHECK in 202605261)
--
--   rent_type     →  site_details.rent_type
--                    (sites.rent_type already migrated in 202606020)
--
--   file_type     →  site_files.file_type
--
--   store_model   →  sites.model
--                    (free text — product names evolve; no CHECK)

BEGIN;

-- ── 1. site_status ────────────────────────────────────────────────────────────

-- sites.status
ALTER TABLE public.sites
    ALTER COLUMN status TYPE text USING status::text;

ALTER TABLE public.sites
    ADD CONSTRAINT chk_sites_status
    CHECK (status IN (
        'draft_submitted', 'shortlisted', 'details_submitted',
        'approved', 'loi_uploaded', 'rejected', 'archived'
    )) NOT VALID;

-- stage_events.from_status / to_status — open set; just convert, no CHECK
ALTER TABLE public.stage_events
    ALTER COLUMN from_status TYPE text USING from_status::text;

ALTER TABLE public.stage_events
    ALTER COLUMN to_status TYPE text USING to_status::text;

DROP TYPE IF EXISTS public.site_status;

-- ── 2. user_role ──────────────────────────────────────────────────────────────

-- stage_events.actor_role (the only remaining column using this type)
ALTER TABLE public.stage_events
    ALTER COLUMN actor_role TYPE text USING actor_role::text;

ALTER TABLE public.stage_events
    ADD CONSTRAINT chk_stage_events_actor_role
    CHECK (actor_role IN ('business_admin', 'supervisor', 'executive', 'system')
           OR actor_role IS NULL) NOT VALID;

DROP TYPE IF EXISTS public.user_role;

-- ── 3. rent_type ─────────────────────────────────────────────────────────────

-- site_details.rent_type (sites.rent_type already text + CHECK since 202606020)
ALTER TABLE public.site_details
    ALTER COLUMN rent_type TYPE text USING rent_type::text;

ALTER TABLE public.site_details
    ADD CONSTRAINT chk_site_details_rent_type
    CHECK (rent_type IN ('fixed', 'revshare', 'mg_revshare') OR rent_type IS NULL)
    NOT VALID;

DROP TYPE IF EXISTS public.rent_type;

-- ── 4. file_type ─────────────────────────────────────────────────────────────

-- site_files.file_type
ALTER TABLE public.site_files
    ALTER COLUMN file_type TYPE text USING file_type::text;

ALTER TABLE public.site_files
    ADD CONSTRAINT chk_site_files_file_type
    CHECK (file_type IN ('loi', 'photo', 'quality_audit')) NOT VALID;

DROP TYPE IF EXISTS public.file_type;

-- ── 5. store_model ───────────────────────────────────────────────────────────

-- sites.model — product names evolve (e.g. "BTC Cafe+", "Roastries"); keep as
-- unconstrained text so new models don't require a migration.
ALTER TABLE public.sites
    ALTER COLUMN model TYPE text USING model::text;

DROP TYPE IF EXISTS public.store_model;

COMMIT;
