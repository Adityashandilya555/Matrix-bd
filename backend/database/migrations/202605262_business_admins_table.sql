-- business_admins: per-tenant promotion grant.
--
-- The base users.role stays in {supervisor, executive}; a row here promotes
-- the user to business_admin scope for that tenant. Modelling the grant in a
-- separate table (instead of a fourth role value) keeps the role CHECK small
-- and makes "demote" a single DELETE.

CREATE TABLE IF NOT EXISTS public.business_admins (
    user_id      uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
    tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    promoted_at  timestamptz NOT NULL DEFAULT now(),
    notes        text
);

CREATE INDEX IF NOT EXISTS idx_business_admins_tenant
    ON public.business_admins(tenant_id);
