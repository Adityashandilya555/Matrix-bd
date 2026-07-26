-- 20260811 — Staggered escalation schedule on launch_approvals
-- (authored 2026-07-24)
--
-- ADDITIVE. Mirrors sites.staggered_escalation so the year-wise staggered rent
-- schedule survives the post-NSO launch review: seeded from the site on create,
-- editable via PATCH /launch-approvals/{id}/rent-fields, and committed back to
-- the canonical sites column at final confirm. Reuses the existing
-- is_valid_staggered_escalation() superset validator (added 20260809).
--
-- Sorts after 20260810 (the launch revenue-share split). BEGIN;/COMMIT; are
-- stripped by the startup runner; kept for parity.

BEGIN;

ALTER TABLE public.launch_approvals
    ADD COLUMN IF NOT EXISTS staggered_escalation jsonb;

ALTER TABLE public.launch_approvals
    DROP CONSTRAINT IF EXISTS chk_la_staggered_escalation;
ALTER TABLE public.launch_approvals
    ADD CONSTRAINT chk_la_staggered_escalation
        CHECK (public.is_valid_staggered_escalation(staggered_escalation));

COMMIT;
