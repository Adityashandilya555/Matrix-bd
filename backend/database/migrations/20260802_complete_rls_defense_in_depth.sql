-- 20260802 — Complete the RLS defense-in-depth layer (#345)
-- (authored 2026-07-17, from the backend security sweep)
--
-- This is anon/PostgREST-only defense-in-depth. Application queries run as the
-- BYPASSRLS `postgres` role, so none of this changes app behaviour — it only
-- hardens what the public `anon`/`authenticated` roles can reach IF the Supabase
-- Data API is ever exposed. Two concrete gaps from the review:
--
--   1. RLS policies across the schema reference public.current_tenant_id() /
--      public.get_current_tenant_id(), but neither function was DEFINED in any
--      in-repo migration. They exist on the live DB, so a fresh DB built purely
--      from these migrations would fail at CREATE POLICY and ship decorative
--      (unenforced) policies. Define both here, idempotently.
--
--   2. public.project_excellence_reviews carries tenant_id + budget data but is
--      the only public tenant table with RLS still disabled (every sibling
--      review table has it on). Enable RLS + a tenant_isolation policy.
--
-- Runner notes: each statement runs in its own transaction; the runner strips
-- bare BEGIN;/COMMIT; and only recognises `$$` for dollar-quote detection, so
-- every function body / DO block below uses `$$`.

-- 1a. Canonical tenant resolver — reads tenant_id from the JWT app_metadata,
--     matching where the backend mints it (app.core.security.issue_token).
CREATE OR REPLACE FUNCTION public.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt() #>> '{app_metadata,tenant_id}', '')::uuid;
$$;

-- 1b. Back-compat alias for older policies that reference get_current_tenant_id().
--     Delegates to the canonical resolver so both names use the same source.
CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT public.current_tenant_id();
$$;

-- 2. Enable RLS + tenant isolation on project_excellence_reviews. Guarded on
--    table existence and idempotent (ENABLE RLS and DROP POLICY IF EXISTS are
--    no-ops on re-run), so this is safe whether or not the table/policy is
--    already present.
DO $$
BEGIN
  IF to_regclass('public.project_excellence_reviews') IS NOT NULL THEN
    ALTER TABLE public.project_excellence_reviews ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON public.project_excellence_reviews;
    CREATE POLICY tenant_isolation ON public.project_excellence_reviews
      USING (tenant_id = public.current_tenant_id())
      WITH CHECK (tenant_id = public.current_tenant_id());
  END IF;
END $$;
