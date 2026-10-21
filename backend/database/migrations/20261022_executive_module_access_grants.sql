-- 20261022 — Cross-module workspace access for executives.
--
-- The executive sibling of 20260930_supervisor_module_access_grants.sql. An
-- executive of one module may ask a business admin for executive access to
-- another, naming the supervisor of that module they will work under. The same
-- reasoning applies and is not repeated at length here: the grant is a
-- SIMULATION, not a membership, because a second user_module_memberships row
-- would let auth_repo.get_primary_membership's `ORDER BY module ... LIMIT 1`
-- silently relocate the executive at their next login.
--
-- This row IS the grant, and it also carries the reporting line in the borrowed
-- module (target_supervisor_id). supervisor_code_service.list_my_team reads it
-- so the chosen supervisor sees the executive on their team; app/core/deps.py
-- probes it on every request carrying X-Override-Module, so a revoke takes
-- effect on the next request rather than at token expiry.
--
-- NSO is excluded by the CHECK below. It is a supervisor-only module
-- (business_admin_service._SUPERVISOR_ONLY_MODULES) with no executive role, so a
-- grant into it would admit an identity no NSO route serves.
--
-- Runner notes (see 20260930 for the full versions):
--   * one STATEMENT per transaction; the file is recorded only once all succeed.
--   * `$$` appears below only as a dollar-quote delimiter, never in a comment.
--   * The RLS block follows 20260804_quality_audit_reports.sql.

CREATE TABLE IF NOT EXISTS public.executive_module_access_grants (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    executive_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    module               text NOT NULL,
    -- SET NULL, not CASCADE: the row is the executive's history as much as the
    -- supervisor's, and approval refuses a row whose supervisor has gone.
    target_supervisor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
    status               text NOT NULL DEFAULT 'pending',
    note                 text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    decided_at           timestamptz,
    decided_by           uuid REFERENCES public.users(id) ON DELETE SET NULL,
    revoked_at           timestamptz,
    revoked_by           uuid REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT chk_emag_module CHECK (
        module IN ('bd', 'legal', 'design', 'project', 'project_excellence')
    ),
    -- `cancelled` is the executive withdrawing their own pending request; it is
    -- not in 20260930's vocabulary because supervisors cannot do that.
    CONSTRAINT chk_emag_status CHECK (
        status IN ('pending', 'approved', 'rejected', 'revoked', 'cancelled')
    )
);

-- One LIVE row per (executive, module). Same reasoning as
-- uq_smag_supervisor_module_live: two approved rows would make a revoke not
-- revoke. Keyed without the supervisor on purpose — an executive works under one
-- chosen supervisor per borrowed module, and changing it is a revoke and a new
-- request, not a second grant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_emag_executive_module_live
    ON public.executive_module_access_grants (executive_id, module)
    WHERE status IN ('pending', 'approved');

CREATE INDEX IF NOT EXISTS idx_emag_tenant_status
    ON public.executive_module_access_grants (tenant_id, status);

-- The Team page's read: approved grants naming this supervisor in this module.
CREATE INDEX IF NOT EXISTS idx_emag_target_supervisor_live
    ON public.executive_module_access_grants (target_supervisor_id, module)
    WHERE status = 'approved';

DO $$
BEGIN
  ALTER TABLE public.executive_module_access_grants ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON public.executive_module_access_grants;
  CREATE POLICY tenant_isolation ON public.executive_module_access_grants
    USING (tenant_id = public.current_tenant_id());
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.executive_module_access_grants FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.executive_module_access_grants FROM authenticated;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'executive_module_access_grants RLS setup skipped: %', SQLERRM;
END $$;
