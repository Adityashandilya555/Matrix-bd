-- 20260803 — RLS + tenant isolation on the shared budget tables (#383)
-- (from the backend security review, 2026-07-17)
--
-- Sibling of 20260802: that migration closed the RLS gap on
-- public.project_excellence_reviews; this one closes it on the two remaining
-- tenant tables that carry budget data — public.site_budgets and
-- public.site_budget_items (added additively by 202606144, which never enabled
-- RLS on them).
--
-- Why this matters even though live is already covered:
--   The Supabase advisor reports both tables as `rls_enabled_no_policy` on the
--   live DB, i.e. RLS is ALREADY on there (someone enabled it out-of-band), so
--   the anon key is already default-denied. But NO in-repo migration enables
--   it — a fresh database built purely from these migrations would ship with
--   RLS OFF on both tables, re-opening the exact anon-key budget-read the
--   review flagged. This migration removes that repo/live drift AND upgrades
--   the posture from "default-denied (no policy)" to "tenant-scoped policy",
--   which also clears the advisor's rls_enabled_no_policy finding for the two
--   tables.
--
-- App behaviour is UNCHANGED: application queries run as the BYPASSRLS role via
-- the pooler, so these policies only ever constrain the anon/authenticated
-- PostgREST roles (which are additionally REVOKE'd ALL by 202606122). Pure
-- anon/PostgREST defense-in-depth.
--
-- Depends on public.current_tenant_id() (defined idempotently in 20260802,
-- which sorts + applies before this file). Reused, not redefined, so there is a
-- single source of truth for the resolver.
--
-- Runner notes: each statement runs in its own transaction; the runner strips
-- bare BEGIN;/COMMIT; and only recognises `$$` for dollar-quote detection, so
-- the DO blocks below use `$$`. Every statement is idempotent (ENABLE RLS and
-- DROP POLICY IF EXISTS are no-ops on re-run), and each is guarded on table
-- existence so the file is safe whether or not the tables are present.

-- 1. site_budgets — budget header (totals, area, covers) per site/phase.
DO $$
BEGIN
  IF to_regclass('public.site_budgets') IS NOT NULL THEN
    ALTER TABLE public.site_budgets ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON public.site_budgets;
    CREATE POLICY tenant_isolation ON public.site_budgets
      USING (tenant_id = public.current_tenant_id())
      WITH CHECK (tenant_id = public.current_tenant_id());
  END IF;
END $$;

-- 2. site_budget_items — the 11 line items per budget/phase.
DO $$
BEGIN
  IF to_regclass('public.site_budget_items') IS NOT NULL THEN
    ALTER TABLE public.site_budget_items ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS tenant_isolation ON public.site_budget_items;
    CREATE POLICY tenant_isolation ON public.site_budget_items
      USING (tenant_id = public.current_tenant_id())
      WITH CHECK (tenant_id = public.current_tenant_id());
  END IF;
END $$;
