-- Migration: Index the highest-value unindexed FK columns (issue #167)
--
-- Postgres does not auto-index FK columns. Unindexed FKs mean:
--   • Sequential scan of the child table on every parent DELETE/UPDATE.
--   • No index path for joins/filters on those columns as data grows.
--
-- We index only the high-value targets identified by the Supabase performance
-- advisor (tenant_id / site_id columns on the join/filter path). The many
-- audit "*_by" FK columns (rarely filtered; cost only on rare user deletes)
-- are deliberately deferred — they can be added incrementally if profiling
-- reveals a hot path.
--
-- NOTE: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
--       Run each statement individually or with autocommit=on.
--       The IF NOT EXISTS guard makes each statement idempotent / re-runnable.

-- design_deliverables — tenant_id join path
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_design_deliverables_tenant_id
    ON public.design_deliverables (tenant_id);

-- launch_review_events — tenant_id join path
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_launch_review_events_tenant_id
    ON public.launch_review_events (tenant_id);

-- project_budget_items — tenant_id join path
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_budget_items_tenant_id
    ON public.project_budget_items (tenant_id);

-- supervisor_invite_codes — tenant_id join path (also helps module-lookup JOINs)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supervisor_invite_codes_tenant_id
    ON public.supervisor_invite_codes (tenant_id);

-- workspace_requests — provisioned_tenant_id FK (reverse-lookup after provisioning)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workspace_requests_provisioned_tenant_id
    ON public.workspace_requests (provisioned_tenant_id);

-- notification_outbox — site_id (queried on every per-site notification flush)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_outbox_site_id
    ON public.notification_outbox (site_id);
