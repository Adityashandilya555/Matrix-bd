-- 202605269 — legal_change_requests table
--
-- Lets BD file a "please flip this No back to Yes" request against a specific
-- field on legal_dd_checklist / site_agreement / site_licensing. Legal
-- supervisor reviews the request from their queue and either approves (which
-- overwrites the underlying value immediately) or rejects (no change, reason
-- recorded).
--
-- Idempotent: every statement uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so
-- re-running against an environment that already has the schema is a no-op.

CREATE TABLE IF NOT EXISTS public.legal_change_requests (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    site_id         uuid NOT NULL REFERENCES public.sites(id)   ON DELETE CASCADE,

    -- which underlying legal row holds the field we want to flip.
    target_table    text NOT NULL CHECK (target_table IN ('legal_dd_checklist', 'site_agreement', 'site_licensing')),

    -- exact column name in that table (e.g. 'title_doc', 'fssai', 'signed').
    field_name      text NOT NULL,

    -- snapshot at the time the request was filed; stays even if legal flips
    -- the value later, so the audit trail is honest.
    current_value   text NOT NULL,
    requested_value text NOT NULL,

    justification   text,

    requested_by    uuid NOT NULL REFERENCES public.users(id),

    status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by     uuid REFERENCES public.users(id),
    reviewer_note   text,

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    reviewed_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_lcr_tenant_status
    ON public.legal_change_requests(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_lcr_site
    ON public.legal_change_requests(site_id);

CREATE INDEX IF NOT EXISTS idx_lcr_requested_by
    ON public.legal_change_requests(requested_by);
