-- user_module_memberships: which modules a user participates in and how.
--
-- A user can be a supervisor in one module and an executive in another; this
-- table records each (user, module) pairing with the role-in-module and the
-- supervising user for executives. UNIQUE (user_id, module) prevents two
-- memberships in the same module for one user.

CREATE TABLE IF NOT EXISTS public.user_module_memberships (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    module          text NOT NULL CHECK (module IN ('bd', 'legal', 'payment')),
    role_in_module  text NOT NULL CHECK (role_in_module IN ('supervisor', 'executive')),
    supervisor_id   uuid REFERENCES public.users(id) ON DELETE SET NULL,
    joined_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, module)
);

CREATE INDEX IF NOT EXISTS idx_umm_tenant_module
    ON public.user_module_memberships(tenant_id, module);

CREATE INDEX IF NOT EXISTS idx_umm_supervisor
    ON public.user_module_memberships(supervisor_id);
