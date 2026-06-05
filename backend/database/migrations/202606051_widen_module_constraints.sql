-- 202606051 — widen module CHECK constraints to include 'design' + 'project'
--
-- module_codes and user_module_memberships were originally created with
--   CHECK (module IN ('bd','legal','payment')).
-- The Design and Project modules were added later as parallel tracks (mirroring
-- sites.design_status / sites.project_status). They need the same org plumbing as
-- the other departments: a dept invite code, and supervisor/executive memberships.
--
-- Without this, rotating a Design/Project dept code or approving a Design/Project
-- supervisor (which inserts a membership) fails the CHECK at runtime. Widening a
-- CHECK constraint is additive and never invalidates existing rows.
--
-- (site_delegations.module was already widened in 202606031.)

ALTER TABLE public.module_codes
    DROP CONSTRAINT IF EXISTS module_codes_module_check;
ALTER TABLE public.module_codes
    ADD CONSTRAINT chk_module_codes_module
    CHECK (module IN ('bd', 'legal', 'payment', 'design', 'project'));

ALTER TABLE public.user_module_memberships
    DROP CONSTRAINT IF EXISTS user_module_memberships_module_check;
ALTER TABLE public.user_module_memberships
    ADD CONSTRAINT chk_user_module_memberships_module
    CHECK (module IN ('bd', 'legal', 'payment', 'design', 'project'));
