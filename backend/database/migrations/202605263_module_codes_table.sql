-- module_codes: per-tenant per-module supervisor invite code.
--
-- A business_admin mints exactly one active code per (tenant, module). The
-- code is consumed by a new account to register as that module's supervisor.
-- Rotation overwrites the code value and sets rotated_at; revocation sets
-- revoked_at without deleting the row so audit history survives.

CREATE TABLE IF NOT EXISTS public.module_codes (
    id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    module      text NOT NULL CHECK (module IN ('bd', 'legal', 'payment')),
    code        text NOT NULL UNIQUE,
    created_by  uuid NOT NULL REFERENCES public.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    rotated_at  timestamptz,
    revoked_at  timestamptz,
    UNIQUE (tenant_id, module)
);

CREATE INDEX IF NOT EXISTS idx_module_codes_tenant_module
    ON public.module_codes(tenant_id, module);
