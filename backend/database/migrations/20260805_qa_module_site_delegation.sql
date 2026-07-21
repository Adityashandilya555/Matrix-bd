-- Quality-audit report tasks are delegated via their own site_delegations
-- module ('quality_audit'), separate from the project-excellence site
-- allocation (see 20260804). Add it to the module CHECK so svc_allocate_qa can
-- insert the delegation row — without this, delegating a QA report (including
-- "delegate to self") 500s on chk_site_delegations_module. Additive; idempotent.
ALTER TABLE public.site_delegations
    DROP CONSTRAINT IF EXISTS chk_site_delegations_module;
ALTER TABLE public.site_delegations
    ADD CONSTRAINT chk_site_delegations_module
        CHECK (module IN ('bd','legal','design','project','nso','project_excellence','financial_closure','quality_audit'));
