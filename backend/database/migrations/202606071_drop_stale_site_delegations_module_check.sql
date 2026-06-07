-- Drop the stale auto-named CHECK constraint on site_delegations.
--
-- When the table was first created (202605271) PostgreSQL auto-named the inline
-- CHECK constraint `site_delegations_module_check` covering only
-- ('bd','legal','payment','design'). The project_execution_foundation migration
-- (202606033) added a replacement named constraint `chk_site_delegations_module`
-- that includes 'project', but only dropped constraints by the new name —
-- leaving the old one alive. PostgreSQL enforces ALL constraints, so every
-- INSERT with module='project' was rejected by the stale constraint, causing
-- a server error whenever a supervisor tried to delegate in the Project module.

ALTER TABLE public.site_delegations
    DROP CONSTRAINT IF EXISTS site_delegations_module_check;
