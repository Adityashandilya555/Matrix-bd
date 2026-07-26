-- 20260815 — Drop dead BD columns.
--
-- Six columns on sites/site_files are written by no code path and hold no data
-- (verified 0 non-null across 258 sites and 148 site_files on the dev database):
--
--   sites.address, sites.notes, sites.spoc_email, sites.spoc_phone
--   site_files.onedrive_item_id, site_files.onedrive_synced_at
--
-- The site create/detail API only ever collects spoc_name; address and notes
-- were never surfaced in any request/response schema nor read as a Site
-- attribute; the onedrive_* pair belonged to an abandoned OneDrive-sync feature
-- that left no code behind. Dropping them removes dead weight with no
-- behavioural impact — the ORM model is updated in the same change.
--
-- Idempotent: DROP COLUMN IF EXISTS is a no-op on re-run.
--
-- Runner notes: each statement runs in its own transaction; the runner strips
-- bare BEGIN;/COMMIT; and only recognises `$$` for dollar-quote detection.

ALTER TABLE public.sites      DROP COLUMN IF EXISTS address;
ALTER TABLE public.sites      DROP COLUMN IF EXISTS notes;
ALTER TABLE public.sites      DROP COLUMN IF EXISTS spoc_email;
ALTER TABLE public.sites      DROP COLUMN IF EXISTS spoc_phone;
ALTER TABLE public.site_files DROP COLUMN IF EXISTS onedrive_item_id;
ALTER TABLE public.site_files DROP COLUMN IF EXISTS onedrive_synced_at;
