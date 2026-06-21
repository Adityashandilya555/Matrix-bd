-- Migration 202606144: shared site budgets (gfc + closure phases) — ADDITIVE ONLY.
--
-- The 11-item budget is a SHARED, module-agnostic entity owned by no single
-- department. Project Excellence fills the 'gfc' phase (post-GFC, pre-project);
-- Financial Closure fills the 'closure' phase (post-launch) with per-line
-- variation vs gfc. This REPLACES the never-applied PE-private tables that
-- migration 202606134 would have created (project_excellence_reviews / _items).
--
-- sites.project_excellence_status + the site_delegations module CHECK were added
-- by hotfix 202606143. The legacy-data cleanup (drop project_budget_items, strip
-- project_reviews budget columns) is split into 202606145 and applied separately
-- with explicit authorization — the merged ORM already ignores those columns, so
-- leaving them in place is harmless.

-- 1. Shared budget header (one row per site, per phase)
CREATE TABLE IF NOT EXISTS public.site_budgets (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    site_id       UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    phase         TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'draft',
    allocated_to  UUID REFERENCES public.users(id),
    budget_total  NUMERIC(14, 2),
    total_indoor_area_sqft NUMERIC(12, 2),
    total_area_sqft NUMERIC(12, 2),
    covers        INTEGER,
    supervisor_comments TEXT,
    admin_comments TEXT,
    approved_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_site_budget_phase  CHECK (phase IN ('gfc','closure')),
    CONSTRAINT chk_site_budget_status CHECK (status IN ('draft','pending_supervisor','pending_admin','approved','rejected')),
    CONSTRAINT uq_site_budget_site_phase UNIQUE (site_id, phase)
);

-- 2. Shared budget line items (11 per site, per phase)
CREATE TABLE IF NOT EXISTS public.site_budget_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    site_id     UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    budget_id   UUID NOT NULL REFERENCES public.site_budgets(id) ON DELETE CASCADE,
    phase       TEXT NOT NULL,
    idx         INTEGER NOT NULL,
    label       TEXT,
    amount      NUMERIC(14, 2),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_site_budget_item_phase CHECK (phase IN ('gfc','closure')),
    CONSTRAINT chk_site_budget_item_idx   CHECK (idx BETWEEN 1 AND 11),
    CONSTRAINT uq_site_budget_item_budget_idx UNIQUE (budget_id, idx)
);

CREATE INDEX IF NOT EXISTS idx_site_budgets_tenant_phase_status ON public.site_budgets (tenant_id, phase, status);
CREATE INDEX IF NOT EXISTS idx_site_budgets_site ON public.site_budgets (site_id);
CREATE INDEX IF NOT EXISTS idx_site_budget_items_site_phase ON public.site_budget_items (site_id, phase);
CREATE INDEX IF NOT EXISTS idx_site_budget_items_budget ON public.site_budget_items (budget_id);

-- 3. sites.financial_closure_status mirror (closure-phase queue / dashboard chip)
ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS financial_closure_status TEXT NOT NULL DEFAULT 'pending';

-- 4. project_reviews: quality-audit becomes calendar-date + two-tier
--    (executive submits date -> supervisor approves -> business_admin confirms).
ALTER TABLE public.project_reviews
    ADD COLUMN IF NOT EXISTS quality_audit_supervisor_approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS quality_audit_supervisor_approved_by UUID REFERENCES public.users(id),
    ADD COLUMN IF NOT EXISTS quality_audit_admin_confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS quality_audit_admin_confirmed_by UUID REFERENCES public.users(id),
    ADD COLUMN IF NOT EXISTS quality_audit_admin_notes TEXT;

ALTER TABLE public.project_reviews DROP CONSTRAINT IF EXISTS chk_project_quality_status;
ALTER TABLE public.project_reviews ADD CONSTRAINT chk_project_quality_status
    CHECK (quality_audit_status IN ('pending','submitted','supervisor_approved','approved','rejected'));

-- 5. Normalize project current_stage ('budget' is no longer a project stage) — UPDATE only.
UPDATE public.project_reviews SET current_stage='execution' WHERE current_stage='budget';
ALTER TABLE public.project_reviews DROP CONSTRAINT IF EXISTS chk_project_current_stage;
ALTER TABLE public.project_reviews ADD CONSTRAINT chk_project_current_stage
    CHECK (current_stage IN ('execution','done'));
ALTER TABLE public.project_reviews ALTER COLUMN current_stage SET DEFAULT 'execution';

-- 6. Design ends at GFC: unblock the in-flight site stuck at the (now removed) BOQ
--    stage and mark every GFC-approved site design-complete. 'boq' stays a valid
--    historical deliverable kind; it is just removed from the live flow (code).
UPDATE public.design_reviews SET current_stage='done' WHERE current_stage='boq';
UPDATE public.sites s
   SET design_status='approved',
       design_approved_at=COALESCE(s.design_approved_at, now())
  FROM public.design_reviews d
 WHERE d.site_id = s.id AND d.gfc_status='approved' AND s.design_status <> 'approved';
