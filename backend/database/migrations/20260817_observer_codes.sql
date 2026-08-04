-- 20260817 — Workspace-level invite code for the read-only `observer` role.
--
-- Shaped after supervisor_invite_codes: one code per scope, rotate by revoking
-- the old row and inserting a new one, so an old code stops working the moment a
-- new one is issued.
--
-- A SEPARATE table rather than a row in module_codes with module='observer'.
-- module_codes means "a code that grants entry to a module", and an observer is
-- workspace-wide and holds no module membership — the same reasoning that left
-- user_module_memberships.role_in_module narrow in 20260816. Storing it there
-- would have worked (the org tree iterates a fixed module list, so it would not
-- have surfaced a phantom department) but it would have encoded a claim about
-- this role that is not true.
--
-- UNIQUE (tenant_id) WHERE revoked_at IS NULL: exactly one live code per
-- workspace, enforced by the database rather than by the rotation code
-- remembering to revoke first. Partial, so revoked rows accumulate as history.

CREATE TABLE IF NOT EXISTS public.observer_codes (
    id         uuid NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id  uuid NOT NULL,
    code       text NOT NULL UNIQUE,
    created_by uuid NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    rotated_at timestamp with time zone,
    revoked_at timestamp with time zone,
    CONSTRAINT observer_codes_pkey PRIMARY KEY (id),
    CONSTRAINT observer_codes_tenant_id_fkey
        FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
    CONSTRAINT observer_codes_created_by_fkey
        FOREIGN KEY (created_by) REFERENCES public.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_observer_codes_live_per_tenant
    ON public.observer_codes (tenant_id)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_observer_codes_code
    ON public.observer_codes (code)
    WHERE revoked_at IS NULL;
