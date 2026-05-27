-- 202605272 — checklist staging (draft / pending_review / published)
--
-- Adds a `stage` column to legal_dd_checklist and site_licensing so executive
-- workflows can save items as drafts, submit for supervisor review, and only
-- become BD-visible once the supervisor publishes.
--
-- DEFAULT 'published' is intentional: existing rows stay BD-visible, so this
-- migration is safe to apply ahead of the rest of the Legal Module v2 slices.
-- New executive-driven inserts will start at 'draft' via service code.
--
-- Idempotent: every statement uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so
-- re-running against an environment that already has the schema is a no-op.

ALTER TABLE public.legal_dd_checklist
    ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'published'
        CHECK (stage IN ('draft', 'pending_review', 'published'));

ALTER TABLE public.site_licensing
    ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'published'
        CHECK (stage IN ('draft', 'pending_review', 'published'));

CREATE INDEX IF NOT EXISTS idx_legal_dd_checklist_stage
    ON public.legal_dd_checklist(stage);

CREATE INDEX IF NOT EXISTS idx_site_licensing_stage
    ON public.site_licensing(stage);
