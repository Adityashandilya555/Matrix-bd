-- Migration 202606142: widen module CHECK constraints to include 'project_excellence'
-- The 134 migration widened site_delegations but missed module_codes,
-- supervisor_invite_codes, and user_module_memberships.

-- module_codes
ALTER TABLE public.module_codes
    DROP CONSTRAINT IF EXISTS module_codes_module_check;
ALTER TABLE public.module_codes
    ADD CONSTRAINT module_codes_module_check
        CHECK (module IN ('bd','legal','design','project','nso','project_excellence'));

-- supervisor_invite_codes
ALTER TABLE public.supervisor_invite_codes
    DROP CONSTRAINT IF EXISTS supervisor_invite_codes_module_check;
ALTER TABLE public.supervisor_invite_codes
    ADD CONSTRAINT supervisor_invite_codes_module_check
        CHECK (module IN ('bd','legal','design','project','nso','project_excellence'));

-- user_module_memberships
ALTER TABLE public.user_module_memberships
    DROP CONSTRAINT IF EXISTS user_module_memberships_module_check;
ALTER TABLE public.user_module_memberships
    ADD CONSTRAINT user_module_memberships_module_check
        CHECK (module IN ('bd','legal','design','project','nso','project_excellence'));
