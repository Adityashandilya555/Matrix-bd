-- supervisor_invite_codes: per-supervisor per-module executive invite code.
--
-- Mirrors module_codes but issued by a supervisor (one per module they own)
-- to invite executives into their module. Same rotate/revoke semantics.

CREATE TABLE IF NOT EXISTS public.supervisor_invite_codes (
    id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id     uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    supervisor_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    module        text NOT NULL CHECK (module IN ('bd', 'legal', 'payment')),
    code          text NOT NULL UNIQUE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    rotated_at    timestamptz,
    revoked_at    timestamptz,
    UNIQUE (supervisor_id, module)
);

CREATE INDEX IF NOT EXISTS idx_supinvite_supervisor
    ON public.supervisor_invite_codes(supervisor_id);
