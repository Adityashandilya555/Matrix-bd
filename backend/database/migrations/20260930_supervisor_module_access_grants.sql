-- 20260930 — Cross-module workspace access for supervisors.
--
-- A supervisor of one module may be granted supervisor access to another by a
-- business admin. The grant is a SIMULATION, not a membership: no
-- user_module_memberships row is ever written. That is deliberate and it is the
-- whole reason this table exists rather than a second membership row —
-- auth_repo.get_primary_membership picks the JWT's module with
-- `ORDER BY module ... LIMIT 1`, so giving a legal supervisor a `bd` membership
-- would silently relocate them to BD at their next login or refresh, with no
-- error anywhere. Writing no row leaves that query's result set untouched.
--
-- This row IS the grant. app/core/deps.py probes it on every authenticated
-- request that carries X-Override-Module, which is what makes a revoke take
-- effect on the next request instead of at token expiry.
--
-- Runner notes:
--   * app/main.py's startup runner applies one STATEMENT per transaction and
--     only records the file once every statement succeeds, so a failure here
--     retries on the next boot.
--   * `$$` appears below only as a dollar-quote delimiter, never inside a `--`
--     comment. The runner's scanner recognises `$$` alone, and a stray one in a
--     comment shreds the file into fragments (the 20260814 / 20260815 bug,
--     guarded by tests/test_migration_parser.py).
--   * Depends on public.current_tenant_id(), defined idempotently by 20260802,
--     which sorts before this file.
--   * The RLS block follows 20260804_quality_audit_reports.sql. It deliberately
--     does NOT follow 202606231_supervisor_executive_requests.sql, whose block
--     queries `pg_policy.schemaname` — a column that exists on the pg_policies
--     VIEW, not on the pg_policy catalog. That file predates the ledger and was
--     baselined rather than executed, so the error never surfaced; copying it
--     would fail every statement-transaction and retry forever.
--
-- Out of scope, recorded here deliberately: a site write made under a borrowed
-- grant is not marked as such. audit_logs ignores actor_role and
-- stage_events.actor_role records the SIMULATED role, so a Legal approval made
-- under a grant is byte-identical to one by Legal's own supervisor. Marking it
-- properly needs a new audit column, a write_audit_event signature change and
-- every caller touched. This is the same gap the business-admin workspace
-- simulation has had since it shipped. What this table does give is a durable
-- window — created_at / decided_at / revoked_at — so "who could have been
-- borrowing which module, and when" is reconstructable by joining it against
-- audit_logs.actor_id.

CREATE TABLE IF NOT EXISTS public.supervisor_module_access_grants (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    supervisor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    module        text NOT NULL,
    status        text NOT NULL DEFAULT 'pending',
    note          text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    decided_at    timestamptz,
    decided_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
    -- Separate from decided_* on purpose: the row is the grant's whole history,
    -- and "approved on the 3rd, revoked on the 20th" must both stay readable.
    revoked_at    timestamptz,
    revoked_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT chk_smag_module CHECK (
        module IN ('bd', 'legal', 'design', 'project', 'nso', 'project_excellence')
    ),
    CONSTRAINT chk_smag_status CHECK (
        status IN ('pending', 'approved', 'rejected', 'revoked')
    )
);

-- One LIVE row per (supervisor, module), where live means pending OR approved.
--
-- Wider than 202606231's `WHERE status = 'pending'`, on purpose. There the row
-- is only a paper trail — the actual grant lives on
-- user_module_memberships.has_executive_access — so a duplicate approved row is
-- harmless. Here the row IS the grant: two approved rows are two live grants,
-- and revoking one would leave deps.py's EXISTS still finding the other, so a
-- revoke would silently not revoke.
--
-- Folding both live states into one index also encodes the state machine for
-- free: you cannot request what you already hold, and you cannot request twice.
-- rejected and revoked are excluded so history accumulates and a supervisor can
-- re-request after a decision.
--
-- It is also the exact access path deps.py probes on every authenticated
-- request carrying an override header.
CREATE UNIQUE INDEX IF NOT EXISTS uq_smag_supervisor_module_live
    ON public.supervisor_module_access_grants (supervisor_id, module)
    WHERE status IN ('pending', 'approved');

CREATE INDEX IF NOT EXISTS idx_smag_tenant_status
    ON public.supervisor_module_access_grants (tenant_id, status);

DO $$
BEGIN
  ALTER TABLE public.supervisor_module_access_grants ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON public.supervisor_module_access_grants;
  CREATE POLICY tenant_isolation ON public.supervisor_module_access_grants
    USING (tenant_id = public.current_tenant_id());
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.supervisor_module_access_grants FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.supervisor_module_access_grants FROM authenticated;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'supervisor_module_access_grants RLS setup skipped: %', SQLERRM;
END $$;
