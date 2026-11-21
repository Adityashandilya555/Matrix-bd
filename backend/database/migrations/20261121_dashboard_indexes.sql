-- Indexes for the role dashboards (app/services/dashboard_service.py).
--
-- /api/dashboard/version runs every 15 seconds per open dashboard and reads
-- max(updated_at) per tenant from each table below; /api/dashboard/summary
-- reads planned openings by launch date. Plain CREATE INDEX IF NOT EXISTS: the
-- startup runner applies one statement per transaction, so CONCURRENTLY is not
-- available, and these tables are small enough for a brief lock.

CREATE INDEX IF NOT EXISTS idx_sites_tenant_updated_at
    ON public.sites (tenant_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_design_reviews_tenant_updated_at
    ON public.design_reviews (tenant_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_project_reviews_tenant_updated_at
    ON public.project_reviews (tenant_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_nso_reviews_tenant_updated_at
    ON public.nso_reviews (tenant_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_site_budgets_tenant_updated_at
    ON public.site_budgets (tenant_id, updated_at);

CREATE INDEX IF NOT EXISTS idx_launch_approvals_tenant_updated_at
    ON public.launch_approvals (tenant_id, updated_at);

-- Planned openings: only rows with a launch date matter.
CREATE INDEX IF NOT EXISTS idx_nso_reviews_tenant_launch_date
    ON public.nso_reviews (tenant_id, launch_date)
    WHERE launch_date IS NOT NULL;
