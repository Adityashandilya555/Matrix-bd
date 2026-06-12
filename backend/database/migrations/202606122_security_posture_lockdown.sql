-- Security posture lockdown (issues #101, #105, #106, #107, #108)
-- Applied to live Supabase via MCP on 2026-06-12 (migration: security_posture_lockdown).
--
-- The frontend talks only to the FastAPI backend (plus the resolve-maps-url
-- Edge Function); nothing legitimately uses PostgREST with the anon or
-- authenticated roles, so those roles get zero table access.

-- #101 (+ repo sweep): RLS was disabled on three tables, exposing every
-- tenant's rows to the browser-bundled anon key. nso_reviews was reported;
-- launch_approvals and launch_review_events shipped the same way.
ALTER TABLE public.nso_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.launch_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.launch_review_events ENABLE ROW LEVEL SECURITY;

-- #106: definer-rights views bypassed base-table RLS (bare anon key could
-- read every tenant's pipeline, user emails, and financials). Run them with
-- the caller's privileges instead.
ALTER VIEW public.pipeline_summary SET (security_invoker = true);
ALTER VIEW public.stuck_sites SET (security_invoker = true);

-- #107 (and the enforcement half of #105): drop the legacy blanket
-- GRANT ALL to anon/authenticated on all 27+ public objects. RLS stops being
-- the only line of defense; a backend-minted JWT replayed against PostgREST
-- now gets "permission denied" instead of full tenant read/write.
-- The backend connects with its own privileged role; service_role grants are
-- untouched.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- Keep future objects locked down too (fail-closed instead of fail-open).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- #108: SECURITY DEFINER trigger function that inserts a caller-controlled
-- role into public.users had EXECUTE granted to anon/authenticated. Not
-- RPC-reachable today (trigger return type), but revoke EXECUTE so it stays
-- unreachable even if refactored.
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_auth_user() FROM anon, authenticated;
