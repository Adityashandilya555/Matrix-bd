-- Migration: Retire the 'payment' module (issue #120)
--
-- The payment module was de-modularised: no dedicated router, no service, no
-- frontend module page remains.  However, stale rows and CHECK constraints
-- still allow (and exist with) module='payment':
--   • module_codes            — 7 rows with module='payment'
--   • user_module_memberships — 1 row  with module='payment'
--   • supervisor_invite_codes — 0 rows (safe to tighten anyway)
--   • site_delegations        — 0 rows (safe to tighten anyway)
--
-- Steps:
--   1. Delete stale 'payment' rows from the four tables.
--   2. Drop the old module CHECK constraints (auto-named by Postgres).
--   3. Re-add named CHECK constraints that exclude 'payment'.

BEGIN;

-- ── 1. Purge stale payment rows ───────────────────────────────────────────────

DELETE FROM public.module_codes            WHERE module = 'payment';
DELETE FROM public.user_module_memberships WHERE module = 'payment';
DELETE FROM public.supervisor_invite_codes WHERE module = 'payment';
DELETE FROM public.site_delegations        WHERE module = 'payment';

-- ── 2. Drop existing module CHECK constraints (auto-named by Postgres) ────────
-- Postgres names inline CHECK constraints as <table>_<col>_check.
-- We use a DO block to find and drop them dynamically so the migration is
-- robust to any renaming that may have occurred.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname, t.relname
    FROM   pg_catalog.pg_constraint c
    JOIN   pg_catalog.pg_class       t ON t.oid = c.conrelid
    JOIN   pg_catalog.pg_namespace   n ON n.oid = t.relnamespace
    JOIN   pg_catalog.pg_attribute   a ON a.attrelid = c.conrelid
                                      AND a.attnum = ANY(c.conkey)
    WHERE  n.nspname = 'public'
    AND    t.relname IN (
             'module_codes',
             'supervisor_invite_codes',
             'user_module_memberships',
             'site_delegations'
           )
    AND    a.attname = 'module'
    AND    c.contype = 'c'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',
      r.relname, r.conname
    );
  END LOOP;
END;
$$;

-- ── 3. Re-add tightened CHECK constraints (payment excluded) ─────────────────

ALTER TABLE public.module_codes
  ADD CONSTRAINT chk_module_codes_module
  CHECK (module IN ('bd','legal','design','project','nso')) NOT VALID;

ALTER TABLE public.supervisor_invite_codes
  ADD CONSTRAINT chk_supervisor_invite_codes_module
  CHECK (module IN ('bd','legal','design','project','nso')) NOT VALID;

ALTER TABLE public.user_module_memberships
  ADD CONSTRAINT chk_user_module_memberships_module
  CHECK (module IN ('bd','legal','design','project','nso')) NOT VALID;

ALTER TABLE public.site_delegations
  ADD CONSTRAINT chk_site_delegations_module
  CHECK (module IN ('bd','legal','design','project','nso')) NOT VALID;

COMMIT;
