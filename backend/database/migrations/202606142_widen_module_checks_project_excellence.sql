-- Migration 202606142: widen module CHECK constraint on module_codes to include 'project_excellence'
-- Real constraint name discovered via pg_constraint: chk_module_codes_module
-- supervisor_invite_codes and user_module_memberships have no module CHECK constraints.
-- 'payment' is retained in the list because existing rows in module_codes use it.

ALTER TABLE public.module_codes
    DROP CONSTRAINT IF EXISTS chk_module_codes_module;
ALTER TABLE public.module_codes
    ADD CONSTRAINT chk_module_codes_module
        CHECK (module IN ('bd','legal','design','project','nso','payment','project_excellence'));
