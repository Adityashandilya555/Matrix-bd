-- 202605268 — legal workflow tables + sites mirror columns
--
-- Mirrors the live Supabase shape applied via the out-of-band migrations
--   20260525184102_add_legal_workflow            (initial)
--   20260526123854_rebuild_legal_three_table_schema (current)
-- so a fresh deploy of this repo lands the same DDL Supabase already runs.
--
-- Adds three 1:1 child tables on sites (legal_dd_checklist, site_agreement,
-- site_licensing) plus six mirror columns on sites so the BD dashboards can
-- read module status without joining the module-owned tables.
--
-- Idempotent: every statement uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so
-- re-running against an environment that already has the schema is a no-op.

ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS legal_review_at   timestamptz,
    ADD COLUMN IF NOT EXISTS legal_approved_at timestamptz,
    ADD COLUMN IF NOT EXISTS legal_rejected_at timestamptz,
    ADD COLUMN IF NOT EXISTS legal_dd_status   text NOT NULL DEFAULT 'pending'
        CHECK (legal_dd_status IN ('pending', 'in_review', 'positive', 'negative')),
    ADD COLUMN IF NOT EXISTS agreement_status  text NOT NULL DEFAULT 'pending'
        CHECK (agreement_status IN ('pending', 'signed', 'registered')),
    ADD COLUMN IF NOT EXISTS licensing_status  text NOT NULL DEFAULT 'pending'
        CHECK (licensing_status IN ('pending', 'partial', 'complete'));

CREATE TABLE IF NOT EXISTS public.legal_dd_checklist (
    site_id          uuid PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
    title_doc        text NOT NULL DEFAULT 'pending' CHECK (title_doc        IN ('pending', 'yes', 'no')),
    sanctioned_plan  text NOT NULL DEFAULT 'pending' CHECK (sanctioned_plan  IN ('pending', 'yes', 'no')),
    oc_cc            text NOT NULL DEFAULT 'pending' CHECK (oc_cc            IN ('pending', 'yes', 'no')),
    commercial_use   text NOT NULL DEFAULT 'pending' CHECK (commercial_use   IN ('pending', 'yes', 'no')),
    property_tax     text NOT NULL DEFAULT 'pending' CHECK (property_tax     IN ('pending', 'yes', 'no')),
    electricity      text NOT NULL DEFAULT 'pending' CHECK (electricity      IN ('pending', 'yes', 'no')),
    fire_noc         text NOT NULL DEFAULT 'pending' CHECK (fire_noc         IN ('pending', 'yes', 'no')),
    other_1          text NOT NULL DEFAULT 'pending' CHECK (other_1          IN ('pending', 'yes', 'no')),
    other_2          text NOT NULL DEFAULT 'pending' CHECK (other_2          IN ('pending', 'yes', 'no')),
    final_verdict    text NOT NULL DEFAULT 'pending' CHECK (final_verdict    IN ('pending', 'positive', 'negative')),
    rejection_reason text,
    reviewed_by      uuid REFERENCES public.users(id),
    approved_by      uuid REFERENCES public.users(id),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.site_agreement (
    site_id       uuid PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
    signed        boolean NOT NULL DEFAULT false,
    signed_at     timestamptz,
    registered    boolean NOT NULL DEFAULT false,
    registered_at timestamptz,
    document_url  text
);

CREATE TABLE IF NOT EXISTS public.site_licensing (
    site_id          uuid PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
    fssai            text NOT NULL DEFAULT 'pending' CHECK (fssai            IN ('pending', 'yes', 'no')),
    health_trade     text NOT NULL DEFAULT 'pending' CHECK (health_trade     IN ('pending', 'yes', 'no')),
    shops_estab_reg  text NOT NULL DEFAULT 'pending' CHECK (shops_estab_reg  IN ('pending', 'yes', 'no')),
    fire_noc         text NOT NULL DEFAULT 'pending' CHECK (fire_noc         IN ('pending', 'yes', 'no')),
    storage_license  text NOT NULL DEFAULT 'pending' CHECK (storage_license  IN ('pending', 'yes', 'no')),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
