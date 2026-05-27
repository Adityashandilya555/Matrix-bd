-- site_delegations: module-aware per-site delegation rows.
--
-- Generalises the original `shortlist_delegations` table so any module
-- (bd / legal / payment) can grant per-site responsibility to an executive
-- without duplicating the schema. The legal module is the first consumer.
--
-- Rules (enforced in app layer, mirrors shortlist delegations):
--   - Only a supervisor in the module can grant or revoke.
--   - Delegate role must be 'executive'. Cannot delegate to a supervisor.
--   - One active delegation per (site, module, delegate_user_id) — enforced
--     by the partial unique index below.
--   - Revocation NEVER deletes the row; sets revoked_at/revoked_by so the
--     audit trail survives.

CREATE TABLE IF NOT EXISTS public.site_delegations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    module text NOT NULL CHECK (module IN ('bd','legal','payment')),
    delegate_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    granted_by uuid NOT NULL REFERENCES public.users(id),
    granted_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    revoked_by uuid REFERENCES public.users(id),
    notes text
);

CREATE UNIQUE INDEX IF NOT EXISTS site_delegations_unique_active
    ON public.site_delegations (site_id, module, delegate_user_id)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS site_delegations_by_module
    ON public.site_delegations (tenant_id, module, delegate_user_id)
    WHERE revoked_at IS NULL;
