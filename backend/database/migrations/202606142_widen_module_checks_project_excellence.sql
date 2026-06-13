-- Migration 202606142: widen module CHECK constraints to include 'project_excellence'
-- Each table had two constraints (chk_* original + *_module_check from a prior partial run).
-- Drop both per table and add one clean constraint.
-- 'payment' is retained because existing rows reference it.

-- module_codes
ALTER TABLE public.module_codes DROP CONSTRAINT IF EXISTS chk_module_codes_module;
ALTER TABLE public.module_codes DROP CONSTRAINT IF EXISTS module_codes_module_check;
ALTER TABLE public.module_codes ADD CONSTRAINT chk_module_codes_module
    CHECK (module IN ('bd','legal','design','project','nso','payment','project_excellence'));

-- supervisor_invite_codes
ALTER TABLE public.supervisor_invite_codes DROP CONSTRAINT IF EXISTS chk_supervisor_invite_codes_module;
ALTER TABLE public.supervisor_invite_codes DROP CONSTRAINT IF EXISTS supervisor_invite_codes_module_check;
ALTER TABLE public.supervisor_invite_codes ADD CONSTRAINT chk_supervisor_invite_codes_module
    CHECK (module IN ('bd','legal','design','project','nso','payment','project_excellence'));

-- user_module_memberships
ALTER TABLE public.user_module_memberships DROP CONSTRAINT IF EXISTS chk_user_module_memberships_module;
ALTER TABLE public.user_module_memberships DROP CONSTRAINT IF EXISTS user_module_memberships_module_check;
ALTER TABLE public.user_module_memberships ADD CONSTRAINT chk_user_module_memberships_module
    CHECK (module IN ('bd','legal','design','project','nso','payment','project_excellence'));
