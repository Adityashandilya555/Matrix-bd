-- 20261104 — Vendor platform foundation.
--
-- Outside fit-out vendor companies get real accounts inside the brand's tenant:
-- a `vendor` role on users, a vendors record, per-vendor staff codes,
-- per-tenant settings and templates (admission rule, daily cutoff, plan
-- phases, mobilisation checklists, portal branding), and the first operational
-- tables (projects = POs to a vendor, daily updates with per-phase progress).
--
-- What keeps a vendor out of Matrix is in the application, not here:
-- app/core/deps.py confines a vendor token to /vendor/* and the auth routes.
--
-- Additive only. users.role is widened the same way 20260816 widened it for
-- observer (discover the inline CHECK by its definition, drop, re-add). Every
-- table and index is IF NOT EXISTS, so a retry after a partial failure is safe;
-- the runner ledgers by filename and re-runs an unrecorded file whole.

DO $$
DECLARE
    con_name text;
BEGIN
    FOR con_name IN
        SELECT con.conname
          FROM pg_constraint con
          JOIN pg_class     rel ON rel.oid = con.conrelid
          JOIN pg_namespace ns  ON ns.oid  = rel.relnamespace
         WHERE ns.nspname  = 'public'
           AND rel.relname = 'users'
           AND con.contype = 'c'
           AND pg_get_constraintdef(con.oid) ILIKE '%role%business_admin%'
    LOOP
        EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', con_name);
    END LOOP;
    ALTER TABLE public.users
        ADD CONSTRAINT users_role_check
        CHECK (role IN ('business_admin', 'observer', 'supervisor', 'executive', 'vendor'));
END $$;

-- stage_events.actor_role is NOT widened: vendor actions in this phase write
-- audit_logs rows, never site stage transitions.

CREATE TABLE IF NOT EXISTS public.vendors (
    id          uuid NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id   uuid NOT NULL,
    name        text NOT NULL,
    legal_name  text,
    gstin       text,
    status      text NOT NULL DEFAULT 'active',
    created_by  uuid,
    created_at  timestamp with time zone NOT NULL DEFAULT now(),
    updated_at  timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT vendors_pkey PRIMARY KEY (id),
    CONSTRAINT vendors_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
    CONSTRAINT vendors_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT chk_vendors_status CHECK (status IN ('active', 'suspended'))
);
CREATE INDEX IF NOT EXISTS idx_vendors_tenant ON public.vendors (tenant_id);

-- One row per vendor user. user_id is the key: an account belongs to exactly
-- one vendor company.
CREATE TABLE IF NOT EXISTS public.vendor_users (
    user_id      uuid NOT NULL,
    tenant_id    uuid NOT NULL,
    vendor_id    uuid NOT NULL,
    vendor_role  text NOT NULL DEFAULT 'site_supervisor',
    approved_by  uuid,
    approved_at  timestamp with time zone,
    created_at   timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT vendor_users_pkey PRIMARY KEY (user_id),
    CONSTRAINT vendor_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
    CONSTRAINT vendor_users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
    CONSTRAINT vendor_users_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE,
    CONSTRAINT vendor_users_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT chk_vendor_users_role CHECK (vendor_role IN ('owner', 'site_supervisor'))
);
CREATE INDEX IF NOT EXISTS idx_vendor_users_vendor ON public.vendor_users (vendor_id);

-- staff = the code site staff enter on the Vendor side's Join tab of the
-- workspace's login page (vendors sign in with the workspace code itself, then
-- choose Vendor login). `kind` leaves room for other code kinds later.
-- Revoke-then-insert on rotation, like observer_codes; old rows stay as history.
CREATE TABLE IF NOT EXISTS public.vendor_codes (
    id          uuid NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id   uuid NOT NULL,
    vendor_id   uuid NOT NULL,
    kind        text NOT NULL DEFAULT 'staff',
    code        text NOT NULL,
    created_by  uuid,
    created_at  timestamp with time zone NOT NULL DEFAULT now(),
    revoked_at  timestamp with time zone,
    CONSTRAINT vendor_codes_pkey PRIMARY KEY (id),
    CONSTRAINT vendor_codes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
    CONSTRAINT vendor_codes_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE CASCADE,
    CONSTRAINT vendor_codes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT chk_vendor_codes_kind CHECK (kind IN ('staff'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_codes_live_per_kind
    ON public.vendor_codes (vendor_id, kind) WHERE revoked_at IS NULL;
-- Codes are looked up case-insensitively from public endpoints; a live code is
-- unique across ALL tenants so a lookup can never be ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_codes_live_code
    ON public.vendor_codes (upper(code)) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.vendor_settings (
    tenant_id               uuid NOT NULL,
    admission_mode          text NOT NULL DEFAULT 'owner_approves_staff',
    update_cutoff_local     time NOT NULL DEFAULT '19:00',
    timezone                text NOT NULL DEFAULT 'Asia/Kolkata',
    mall_duration_days      integer NOT NULL DEFAULT 40,
    non_mall_duration_days  integer NOT NULL DEFAULT 45,
    portal_title            text,
    accent_color            text,
    welcome_text            text,
    support_contact         text,
    logo_path               text,
    updated_by              uuid,
    updated_at              timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT vendor_settings_pkey PRIMARY KEY (tenant_id),
    CONSTRAINT vendor_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
    CONSTRAINT vendor_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT chk_vendor_settings_admission CHECK (admission_mode IN ('owner_approves_staff', 'admin_approves_all')),
    CONSTRAINT chk_vendor_settings_durations CHECK (mall_duration_days BETWEEN 5 AND 365 AND non_mall_duration_days BETWEEN 5 AND 365)
);

CREATE TABLE IF NOT EXISTS public.vendor_plan_phases (
    id          uuid NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id   uuid NOT NULL,
    site_type   text NOT NULL,
    phase_key   text NOT NULL,
    name        text NOT NULL,
    start_day   integer NOT NULL,
    end_day     integer NOT NULL,
    weight      integer NOT NULL,
    sort_order  integer NOT NULL DEFAULT 0,
    CONSTRAINT vendor_plan_phases_pkey PRIMARY KEY (id),
    CONSTRAINT vendor_plan_phases_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
    CONSTRAINT chk_vendor_plan_phases_site_type CHECK (site_type IN ('mall', 'non_mall')),
    CONSTRAINT chk_vendor_plan_phases_days CHECK (start_day >= 1 AND end_day >= start_day),
    CONSTRAINT chk_vendor_plan_phases_weight CHECK (weight BETWEEN 0 AND 100),
    CONSTRAINT uq_vendor_plan_phases_key UNIQUE (tenant_id, site_type, phase_key)
);

CREATE TABLE IF NOT EXISTS public.vendor_checklist_items (
    id          uuid NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id   uuid NOT NULL,
    kind        text NOT NULL,
    label       text NOT NULL,
    sort_order  integer NOT NULL DEFAULT 0,
    active      boolean NOT NULL DEFAULT true,
    CONSTRAINT vendor_checklist_items_pkey PRIMARY KEY (id),
    CONSTRAINT vendor_checklist_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
    CONSTRAINT chk_vendor_checklist_kind CHECK (kind IN ('mobilisation_vendor', 'mobilisation_brand'))
);
CREATE INDEX IF NOT EXISTS idx_vendor_checklist_items_tenant ON public.vendor_checklist_items (tenant_id);

-- A fit-out PO issued to a vendor company. site_id links a Matrix site where
-- one exists; it is optional so a PO can be raised before the site record is
-- complete.
CREATE TABLE IF NOT EXISTS public.vendor_projects (
    id                uuid NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id         uuid NOT NULL,
    vendor_id         uuid NOT NULL,
    site_id           uuid,
    ca_code           text,
    name              text NOT NULL,
    city              text NOT NULL,
    brand             text,
    site_type         text NOT NULL DEFAULT 'non_mall',
    po_number         text NOT NULL,
    po_value          numeric(14,2) NOT NULL,
    po_date           date NOT NULL,
    start_date        date NOT NULL,
    accepted_at       timestamp with time zone,
    accepted_by       uuid,
    supervisor_name   text,
    supervisor_phone  text,
    crew_size         integer,
    delivery_plan     text,
    status            text NOT NULL DEFAULT 'active',
    handed_over_on    date,
    created_by        uuid,
    created_at        timestamp with time zone NOT NULL DEFAULT now(),
    updated_at        timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT vendor_projects_pkey PRIMARY KEY (id),
    CONSTRAINT vendor_projects_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
    CONSTRAINT vendor_projects_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE RESTRICT,
    CONSTRAINT vendor_projects_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE SET NULL,
    CONSTRAINT vendor_projects_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT vendor_projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT chk_vendor_projects_site_type CHECK (site_type IN ('mall', 'non_mall')),
    CONSTRAINT chk_vendor_projects_status CHECK (status IN ('active', 'handed_over', 'cancelled')),
    CONSTRAINT chk_vendor_projects_po_value CHECK (po_value > 0),
    CONSTRAINT chk_vendor_projects_dates CHECK (start_date >= po_date)
);
CREATE INDEX IF NOT EXISTS idx_vendor_projects_tenant_vendor ON public.vendor_projects (tenant_id, vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_projects_site ON public.vendor_projects (site_id);

CREATE TABLE IF NOT EXISTS public.vendor_project_checks (
    project_id  uuid NOT NULL,
    item_id     uuid NOT NULL,
    checked     boolean NOT NULL DEFAULT false,
    checked_by  uuid,
    checked_at  timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT vendor_project_checks_pkey PRIMARY KEY (project_id, item_id),
    CONSTRAINT vendor_project_checks_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.vendor_projects(id) ON DELETE CASCADE,
    CONSTRAINT vendor_project_checks_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.vendor_checklist_items(id) ON DELETE CASCADE,
    CONSTRAINT vendor_project_checks_checked_by_fkey FOREIGN KEY (checked_by) REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.vendor_daily_updates (
    id                  uuid NOT NULL DEFAULT uuid_generate_v4(),
    tenant_id           uuid NOT NULL,
    project_id          uuid NOT NULL,
    report_date         date NOT NULL,
    day_no              integer NOT NULL,
    manpower            integer NOT NULL DEFAULT 0,
    supervisor_on_site  boolean NOT NULL DEFAULT true,
    ppe_ok              boolean NOT NULL DEFAULT true,
    material            text,
    note                text,
    hindrance_text      text,
    submitted_at        timestamp with time zone NOT NULL DEFAULT now(),
    submitted_by        uuid,
    submitted_late      boolean NOT NULL DEFAULT false,
    CONSTRAINT vendor_daily_updates_pkey PRIMARY KEY (id),
    CONSTRAINT vendor_daily_updates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
    CONSTRAINT vendor_daily_updates_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.vendor_projects(id) ON DELETE CASCADE,
    CONSTRAINT vendor_daily_updates_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT uq_vendor_daily_updates_day UNIQUE (project_id, report_date),
    CONSTRAINT chk_vendor_daily_updates_manpower CHECK (manpower >= 0)
);

CREATE TABLE IF NOT EXISTS public.vendor_update_progress (
    update_id  uuid NOT NULL,
    phase_key  text NOT NULL,
    percent    integer NOT NULL,
    CONSTRAINT vendor_update_progress_pkey PRIMARY KEY (update_id, phase_key),
    CONSTRAINT vendor_update_progress_update_id_fkey FOREIGN KEY (update_id) REFERENCES public.vendor_daily_updates(id) ON DELETE CASCADE,
    CONSTRAINT chk_vendor_update_progress_percent CHECK (percent BETWEEN 0 AND 100)
);
