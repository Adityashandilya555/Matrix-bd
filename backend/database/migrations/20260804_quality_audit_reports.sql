-- 20260804 — Quality-audit reports (before/after PDFs) for the Project-Excellence
-- Quality Audit tab + the Project NSO Handover tab.
--
-- Adds public.quality_audit_reports: one row per (site, kind), kind ∈
-- {'before' (primary), 'after' (secondary)}. Project Excellence uploads a PDF
-- and pushes each report independently. Pushing 'before' completes the project
-- (surfacing it in NSO Handover); pushing 'after' re-flags the reports as unread
-- for the Project module. Also adds project_reviews.qa_reports_viewed_by_project_at
-- — the per-site timestamp of the last time a Project user opened the reports; the
-- View button is "unread" (yellow) whenever any report's pushed_at is newer.
--
-- Runner notes: each statement runs in its own transaction; every statement is
-- idempotent (IF NOT EXISTS / IF EXISTS). RLS mirrors the sibling tenant tables
-- (20260802/20260803): app queries run as the BYPASSRLS pooler role, so the
-- tenant policy only constrains anon/PostgREST. Depends on
-- public.current_tenant_id() (defined idempotently in 20260802, which sorts
-- first). The RLS/REVOKE block is best-effort (guarded) so the essential
-- table+column always land even on a DB without the anon/authenticated roles.

CREATE TABLE IF NOT EXISTS public.quality_audit_reports (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    site_id     uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    kind        text NOT NULL,
    file_key    text NOT NULL,
    file_name   text,
    uploaded_at timestamptz NOT NULL DEFAULT now(),
    uploaded_by uuid REFERENCES public.users(id),
    pushed_at   timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_qa_report_kind CHECK (kind IN ('before','after')),
    CONSTRAINT uq_qa_report_site_kind UNIQUE (site_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_qa_reports_site ON public.quality_audit_reports (site_id);

ALTER TABLE public.project_reviews
    ADD COLUMN IF NOT EXISTS qa_reports_viewed_by_project_at timestamptz;

DO $$
BEGIN
  ALTER TABLE public.quality_audit_reports ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON public.quality_audit_reports;
  CREATE POLICY tenant_isolation ON public.quality_audit_reports
    USING (tenant_id = public.current_tenant_id());
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.quality_audit_reports FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.quality_audit_reports FROM authenticated;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'quality_audit_reports RLS setup skipped: %', SQLERRM;
END $$;
