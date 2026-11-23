-- Re-assert the widened sites.status check from 202606141_drop_legacy_enum_types.
--
-- schema.sql carried the pre-202606141 list (no legal_review, legal_approved,
-- legal_rejected, pushed_to_payments, launched) until the dashboard PR fixed it.
-- A database built from that older schema.sql baselines every migration
-- without running it, so it kept the narrow check and rejects every site that
-- moves past LOI. Production got the wide check from 202606141 itself; this
-- makes any database built from the old file match. Idempotent: drop if
-- present, then add the same definition 202606141 uses (NOT VALID, as there).

ALTER TABLE public.sites DROP CONSTRAINT IF EXISTS chk_sites_status;

ALTER TABLE public.sites
    ADD CONSTRAINT chk_sites_status
    CHECK (status IN (
        'draft_submitted', 'shortlisted', 'details_submitted',
        'approved', 'loi_uploaded', 'legal_review', 'legal_approved',
        'legal_rejected', 'pushed_to_payments', 'rejected', 'archived',
        'launched'
    )) NOT VALID;
