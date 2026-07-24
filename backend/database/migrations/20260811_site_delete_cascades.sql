-- 20260811 — Make a site deletable in one statement.
--
-- The business admin can now permanently delete a site (duplicate rows created
-- by two people entering the same location, mostly). 16 of the 21 tables that
-- reference sites(id) already declare ON DELETE CASCADE; these five predate
-- that convention and would block the DELETE with an FK violation:
--
--   site_details, site_files, stage_events, notification_outbox, approvals
--
-- Cascading them keeps the delete atomic (one statement, one transaction)
-- instead of an ordered hand-written teardown that silently rots every time a
-- new child table lands. Nothing else changes: these rows are meaningless once
-- their site is gone, and the deletion itself is recorded in audit_logs with
-- site_id = NULL so the trail survives the cascade.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS + ADD re-creates the same constraint
-- name with the added delete rule, so a re-run is a no-op in effect.
--
-- Runner notes: each statement runs in its own transaction; the runner strips
-- bare BEGIN;/COMMIT; and only recognises `$$` for dollar-quote detection.

ALTER TABLE public.site_details
    DROP CONSTRAINT IF EXISTS site_details_site_id_fkey;
ALTER TABLE public.site_details
    ADD CONSTRAINT site_details_site_id_fkey
    FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE;

ALTER TABLE public.site_files
    DROP CONSTRAINT IF EXISTS site_files_site_id_fkey;
ALTER TABLE public.site_files
    ADD CONSTRAINT site_files_site_id_fkey
    FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE;

ALTER TABLE public.stage_events
    DROP CONSTRAINT IF EXISTS stage_events_site_id_fkey;
ALTER TABLE public.stage_events
    ADD CONSTRAINT stage_events_site_id_fkey
    FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE;

ALTER TABLE public.notification_outbox
    DROP CONSTRAINT IF EXISTS notification_outbox_site_id_fkey;
ALTER TABLE public.notification_outbox
    ADD CONSTRAINT notification_outbox_site_id_fkey
    FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE;

ALTER TABLE public.approvals
    DROP CONSTRAINT IF EXISTS approvals_site_id_fkey;
ALTER TABLE public.approvals
    ADD CONSTRAINT approvals_site_id_fkey
    FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE;

-- Safety net for any child table added between this migration being written and
-- applied: report anything still pointing at sites without a delete rule, so a
-- failing delete is diagnosed from the deploy log rather than from a 500.
DO $$
DECLARE
    missing text;
BEGIN
    SELECT string_agg(format('%s.%s', conrelid::regclass, conname), ', ')
      INTO missing
      FROM pg_constraint
     WHERE confrelid = 'public.sites'::regclass
       AND contype = 'f'
       AND confdeltype <> 'c';

    IF missing IS NOT NULL THEN
        RAISE WARNING
            'Tables still reference sites(id) without ON DELETE CASCADE: %. '
            'Deleting a site will fail until these are cascaded.', missing;
    END IF;
END
$$;
