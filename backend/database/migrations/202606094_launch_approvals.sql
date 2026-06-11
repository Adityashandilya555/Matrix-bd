-- 202606094 — Post-NSO launch approval flow.
--
-- Adds the multi-step approval chain that runs after NSO final_approved_at
-- is set:
--
--   NSO Final Approval → Admin reviews + edits commercial fields → BD confirms
--   → Supervisor approves → Super Admin approves → LAUNCHED
--
-- Three additive changes:
--   1. Add escalation_date to site_details  (extra field requested)
--   2. Add is_launched + launched_at to sites  (cross-module highlight flag)
--   3. Create launch_approvals table  (the full approval workflow)
--
-- BACKWARD COMPATIBLE — all new columns are nullable / have safe defaults.

BEGIN;

-- ── 1. escalation_date on site_details ────────────────────────────────────────
ALTER TABLE public.site_details
    ADD COLUMN IF NOT EXISTS escalation_date date;

-- ── 2. is_launched / launched_at on sites ─────────────────────────────────────
ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS is_launched boolean NOT NULL DEFAULT false;
ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS launched_at timestamp with time zone;

-- ── 3. launch_approvals table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.launch_approvals (
    id              uuid          PRIMARY KEY DEFAULT uuid_generate_v4(),
    site_id         uuid          NOT NULL UNIQUE
                                  REFERENCES public.sites(id) ON DELETE CASCADE,
    tenant_id       uuid          NOT NULL
                                  REFERENCES public.tenants(id) ON DELETE CASCADE,

    -- Editable snapshot of commercial / Add-Details fields.
    -- Pre-populated from site_details + sites when the admin first opens the
    -- record; admin (and BD on confirm) can adjust before locking down.
    rent_type               text,
    fixed_rent_amt          numeric(14,2),
    expected_rent           numeric(14,2),
    rev_share_pct           numeric(6,2),
    escalation_pct          numeric(6,2),
    escalation_date         date,
    expected_escalation_years integer,
    cam_charges             numeric(14,2),
    security_deposit        numeric(14,2),
    brokerage               numeric(14,2),
    lock_in_months          integer,
    tenure_months           integer,
    rent_free_days          integer,
    carpet_area_sqft        numeric(10,2),
    estimated_monthly_sales numeric(14,2),
    capex                   numeric(14,2),
    score                   numeric(6,2),
    notes                   text,

    -- Workflow status
    -- pending             → NSO final done, awaiting admin review
    -- admin_approved      → Admin edited + approved; sent to BD
    -- bd_confirmed        → BD confirmed (shows as "verified" in admin portal)
    -- supervisor_approved → Supervisor approved
    -- super_admin_approved→ Super admin approved; Launch button unlocks
    -- launched            → Site launched
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending', 'admin_approved', 'bd_confirmed',
            'supervisor_approved', 'super_admin_approved', 'launched'
        )),

    -- Approval chain
    admin_approved_at       timestamp with time zone,
    admin_approved_by       uuid REFERENCES public.users(id),
    bd_confirmed_at         timestamp with time zone,
    bd_confirmed_by         uuid REFERENCES public.users(id),
    supervisor_approved_at  timestamp with time zone,
    supervisor_approved_by  uuid REFERENCES public.users(id),
    super_admin_approved_at timestamp with time zone,
    super_admin_approved_by uuid REFERENCES public.users(id),
    launched_at             timestamp with time zone,
    launched_by             uuid REFERENCES public.users(id),

    created_at  timestamp with time zone NOT NULL DEFAULT now(),
    updated_at  timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_launch_approvals_tenant_status
    ON public.launch_approvals(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_launch_approvals_site_id
    ON public.launch_approvals(site_id);

COMMIT;
