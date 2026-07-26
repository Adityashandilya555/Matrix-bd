-- Undo for business-admin 2D/3D deliverable decisions.
--
-- The audit log CANNOT serve as the source of truth for an inverse: of the 89
-- write_audit_event call sites, ~72% record only `action` + free-text `detail`,
-- and the whole design module records no before-state at all. So the prior
-- values are snapshotted HERE, at action time — the same shape that makes
-- archive/revive work (sites.archived_from_status).
--
-- One row per undoable action, consumed exactly once. `snapshot` carries an
-- explicit snapshot_version so a row written by an older deploy is refused
-- rather than mis-restored.
--
-- Deliberately NOT a generic rollback ledger: only actions with a hand-written
-- compensating function ever get a row, so an entry existing is itself the
-- whitelist check. Additive; no backfill (absent rows simply aren't undoable).
CREATE TABLE IF NOT EXISTS public.reversible_actions (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id    uuid NOT NULL REFERENCES public.tenants(id),
    site_id      uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    audit_log_id uuid NULL REFERENCES public.audit_logs(id),
    action       text NOT NULL,
    entity_type  text NOT NULL,
    entity_id    uuid NOT NULL,
    actor_id     uuid NOT NULL REFERENCES public.users(id),
    snapshot     jsonb NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    consumed_at  timestamptz NULL,
    consumed_by  uuid NULL REFERENCES public.users(id)
);

-- The only hot read: "open reversible actions for this site". consumed_at is in
-- the index so the IS NULL filter is covered.
CREATE INDEX IF NOT EXISTS idx_reversible_actions_site_open
    ON public.reversible_actions (site_id, consumed_at);

-- Tenant-scoped listing (every query carries tenant_id — concurrency-audit
-- skill invariant #3).
CREATE INDEX IF NOT EXISTS idx_reversible_actions_tenant_created
    ON public.reversible_actions (tenant_id, created_at DESC);
