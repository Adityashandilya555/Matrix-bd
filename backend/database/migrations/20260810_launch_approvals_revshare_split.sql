-- 20260810 — D4: revenue-share split on launch_approvals
-- (authored 2026-07-24; completes Rent_Type_Integration_Plan.pdf decision D4)
--
-- ADDITIVE. Two nullable columns mirroring sites.revshare_dinein_pct /
-- revshare_delivery_pct, so the Dine-in / Delivery split survives the post-NSO
-- launch-approval loop: seeded from the site on create, editable via
-- PATCH /launch-approvals/{id}/rent-fields, and committed back to the canonical
-- sites columns at final confirm. Nothing dropped, renamed, or narrowed.
--
-- Sorts after 20260809 (which added the columns to sites) so the launch-stage
-- copy lands after the pipeline-stage one on a fresh DB.
-- BEGIN;/COMMIT; are stripped by the startup runner (each statement runs in its
-- own transaction); kept for parity with sibling migrations.

BEGIN;

ALTER TABLE public.launch_approvals
    ADD COLUMN IF NOT EXISTS revshare_dinein_pct   numeric(6, 2),
    ADD COLUMN IF NOT EXISTS revshare_delivery_pct numeric(6, 2);

ALTER TABLE public.launch_approvals
    DROP CONSTRAINT IF EXISTS chk_la_revshare_dinein_range;
ALTER TABLE public.launch_approvals
    ADD CONSTRAINT chk_la_revshare_dinein_range
        CHECK (revshare_dinein_pct IS NULL OR (revshare_dinein_pct BETWEEN 0 AND 100));

ALTER TABLE public.launch_approvals
    DROP CONSTRAINT IF EXISTS chk_la_revshare_delivery_range;
ALTER TABLE public.launch_approvals
    ADD CONSTRAINT chk_la_revshare_delivery_range
        CHECK (revshare_delivery_pct IS NULL OR (revshare_delivery_pct BETWEEN 0 AND 100));

COMMIT;
