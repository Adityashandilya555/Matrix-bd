-- Add has_executive_access to user_module_memberships
ALTER TABLE public.user_module_memberships
  ADD COLUMN IF NOT EXISTS has_executive_access boolean NOT NULL DEFAULT false;

-- Create supervisor_executive_requests table
CREATE TABLE IF NOT EXISTS public.supervisor_executive_requests (
  id            uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id     uuid NOT NULL,
  supervisor_id uuid NOT NULL,
  module        text NOT NULL CHECK (module IN ('bd','legal','design','project','nso','project_excellence')),
  status        text NOT NULL DEFAULT 'pending'::text CHECK (status IN ('pending','approved','rejected')),
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  decided_at    timestamp with time zone,
  decided_by    uuid,
  CONSTRAINT supervisor_executive_requests_pkey PRIMARY KEY (id),
  CONSTRAINT supervisor_executive_requests_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT supervisor_executive_requests_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT supervisor_executive_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(id) ON DELETE SET NULL
);

-- Ensure a supervisor can only have one pending request per module at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_supervisor_executive_requests_pending
  ON public.supervisor_executive_requests (supervisor_id, module)
  WHERE status = 'pending';

-- Index for querying requests efficiently
CREATE INDEX IF NOT EXISTS idx_supervisor_executive_requests_tenant_status
  ON public.supervisor_executive_requests (tenant_id, status);

-- Row-Level Security (#310): without this, the table is readable/writable by
-- anyone via PostgREST's /rest/v1/ endpoint with just the anon key, across all
-- tenants. The backend connects as a BYPASSRLS role so this policy only
-- constrains direct PostgREST/anon access.
ALTER TABLE public.supervisor_executive_requests ENABLE ROW LEVEL SECURITY;

-- Idempotent creation of tenant_isolation policy (CodeAnt review – Major severity)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policy
        WHERE schemaname = 'public'
          AND tablename  = 'supervisor_executive_requests'
          AND policyname = 'tenant_isolation'
    ) THEN
        CREATE POLICY tenant_isolation ON public.supervisor_executive_requests
          USING (tenant_id = public.current_tenant_id())
          WITH CHECK (tenant_id = public.current_tenant_id());
    END IF;
END
$$;
