-- Drop redundant duplicate indexes on public.approvals (write-amplification fix).
--
-- Problem (identified via pg_stat_user_indexes / Supabase Performance Advisors):
--   1. idx_approvals_approver   ≡ idx_approvals_approver_id
--      Both are single-column indexes on (approver_id). Only one is needed;
--      the _id variant is the canonical name used by the SQLAlchemy model.
--
--   2. idx_approvals_site       ≡ idx_approvals_site_id
--      Both are single-column indexes on (site_id). Additionally, every query
--      on this table does WHERE site_id = X ORDER BY created_at DESC, so a
--      composite (site_id, created_at DESC) covers the filter AND the sort in
--      a single index scan, making the bare site_id index redundant.
--
-- Fix:
--   • Drop idx_approvals_approver  (exact duplicate — keep idx_approvals_approver_id)
--   • Drop idx_approvals_site      (exact duplicate)
--   • Drop idx_approvals_site_id   (subsumed by the new composite below)
--   • Create idx_approvals_site_created  (site_id, created_at DESC)
--     Covers: loi_service query (site_id = X ORDER BY created_at DESC LIMIT 1)
--             query_service queries (site_id IN (...) ORDER BY created_at DESC)

DROP INDEX IF EXISTS public.idx_approvals_approver;
DROP INDEX IF EXISTS public.idx_approvals_site;
DROP INDEX IF EXISTS public.idx_approvals_site_id;

CREATE INDEX IF NOT EXISTS idx_approvals_site_created
    ON public.approvals (site_id, created_at DESC);
