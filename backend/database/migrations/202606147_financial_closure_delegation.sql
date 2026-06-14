-- Phase E: Financial Closure is filled by a project executive via delegate-or-self.
-- Scope it with its own site_delegations module ('financial_closure') so it never
-- collides with the live project-execution delegation. sites.financial_closure_status
-- was already added by 202606144. Additive.
ALTER TABLE public.site_delegations
    DROP CONSTRAINT IF EXISTS chk_site_delegations_module;
ALTER TABLE public.site_delegations
    ADD CONSTRAINT chk_site_delegations_module
        CHECK (module IN ('bd','legal','design','project','nso','project_excellence','financial_closure'));
