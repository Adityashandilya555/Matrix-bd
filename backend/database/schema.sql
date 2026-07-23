-- Reference schema — regenerated 2026-06-13 to match the live database.
-- WARNING: This file is for documentation / onboarding reference only.
--          It is NOT meant to be executed directly against a blank database.
--          Use the numbered migration files in database/migrations/ in order.
--
-- Last sync: covers all 27 live tables as of migration 202606141.
-- Enum types (site_status, user_role, rent_type, file_type, store_model)
-- were retired by migration 202606141 — all affected columns are now text
-- with CHECK constraints.

-- ── Functions ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_valid_staggered_escalation(arr jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    elem jsonb;
    y int;
    p float;
BEGIN
    IF arr IS NULL THEN RETURN true; END IF;
    IF jsonb_typeof(arr) != 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(arr) > 5 THEN RETURN false; END IF;
    FOR elem IN SELECT * FROM jsonb_array_elements(arr)
    LOOP
        BEGIN
            y := (elem->>'year')::int;
            p := (elem->>'percent')::float;
            IF y <= 0 OR p < 0 OR p > 100 THEN RETURN false; END IF;
        EXCEPTION WHEN OTHERS THEN
            RETURN false;
        END;
    END LOOP;
    RETURN true;
END;
$$;

-- ── tenants ───────────────────────────────────────────────────────────────────
CREATE TABLE public.tenants (
  id             uuid NOT NULL DEFAULT uuid_generate_v4(),
  slug           text NOT NULL UNIQUE,
  name           text NOT NULL,
  plan           text NOT NULL DEFAULT 'standard'::text,
  seat_limit     integer NOT NULL DEFAULT 10,
  workspace_code text NOT NULL,
  logo_url       text,                           -- per-tenant branded login logo (202606081)
  created_at     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT tenants_pkey PRIMARY KEY (id)
);

-- ── users ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.users (
  id            uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id     uuid NOT NULL,
  email         text NOT NULL,
  name          text NOT NULL,
  role          text NOT NULL DEFAULT 'executive'::text
                  CHECK (role IN ('business_admin','supervisor','executive')),
  is_active     boolean NOT NULL DEFAULT true,
  assigned_city text,
  notes         text,
  password_hash text,                            -- bcrypt hash; NULL = passwordless (202606081)
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  updated_at    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_tenant_id_email_key UNIQUE (tenant_id, email),
  CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);

-- ── sites ─────────────────────────────────────────────────────────────────────
CREATE TABLE public.sites (
  id                       uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id                uuid NOT NULL,
  code                     text,
  status                   text NOT NULL DEFAULT 'draft_submitted'::text,  -- site_status enum retired (202606141)
  name                     text NOT NULL,
  city                     text NOT NULL,
  address                  text,
  visit_date               date,
  notes                    text,
  model                    text,                 -- store_model enum retired (202606141); e.g. 'BTC Cafe+'
  spoc_name                text,
  spoc_email               text,
  spoc_phone               text,
  google_maps_pin          text,
  google_maps_url          text,
  expected_rent            numeric(12,2),
  rent_type                text,
  expected_escalation_pct  numeric(6,2),
  expected_escalation_years integer,
  expected_revshare_pct    numeric(6,2),
  rent_set_at              timestamp with time zone,
  submitted_by             uuid NOT NULL,
  assigned_to              uuid,
  supervisor_id            uuid,
  draft_submitted_at       timestamp with time zone NOT NULL DEFAULT now(),
  shortlisted_at           timestamp with time zone,
  details_submitted_at     timestamp with time zone,
  approved_at              timestamp with time zone,
  loi_uploaded_at          timestamp with time zone,
  pushed_to_payments_at    timestamp with time zone,
  rejected_at              timestamp with time zone,
  archived_at              timestamp with time zone,
  legal_review_at          timestamp with time zone,
  legal_approved_at        timestamp with time zone,
  legal_rejected_at        timestamp with time zone,
  legal_dd_status          text NOT NULL DEFAULT 'pending'::text
                             CHECK (legal_dd_status IN ('pending','in_review','positive','negative')),
  agreement_status         text NOT NULL DEFAULT 'pending'::text
                             CHECK (agreement_status IN ('pending','signed','registered')),
  licensing_status         text NOT NULL DEFAULT 'pending'::text
                             CHECK (licensing_status IN ('pending','partial','complete')),
  design_status            text NOT NULL DEFAULT 'pending'::text,
  design_approved_at       timestamp with time zone,
  project_status           text NOT NULL DEFAULT 'pending'::text
                             CHECK (project_status IN ('pending','allocated','budgeting','in_progress','done')),
  project_completed_at     timestamp with time zone,
  kyc_verified             boolean NOT NULL DEFAULT false,
  ca_code                  text,
  finance_amount           numeric(14,2),
  finance_status           text NOT NULL DEFAULT 'pending'::text,
  rejection_reason         text,
  archive_note             text,
  loi_rejection_note       text,                                   -- supervisor's reason for sending an LOI back (20260807)
  archived_from_status     text,
  is_launched              boolean NOT NULL DEFAULT false,  -- set by Launch Approval workflow (202606094)
  launched_at              timestamp with time zone,
  area_sqft                integer NOT NULL DEFAULT 0,
  staggered_escalation     jsonb,
  created_at               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at               timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sites_pkey PRIMARY KEY (id),
  CONSTRAINT sites_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT sites_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(id),
  CONSTRAINT sites_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id),
  CONSTRAINT sites_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES public.users(id),
  CONSTRAINT chk_sites_status CHECK (status IN (
      'draft_submitted','shortlisted','details_submitted',
      'approved','loi_uploaded','rejected','archived'
  )) NOT VALID,
  CONSTRAINT chk_sites_rent_type CHECK (
      (rent_type IN ('fixed','revshare','mg_revshare','staggered')) OR (rent_type IS NULL)
  ),
  CONSTRAINT chk_area_sqft_positive CHECK (area_sqft >= 0),
  CONSTRAINT chk_staggered_escalation CHECK (public.is_valid_staggered_escalation(staggered_escalation))
);
CREATE INDEX idx_sites_tenant_id_status ON public.sites(tenant_id, status);
CREATE INDEX idx_sites_assigned_to ON public.sites(assigned_to);
CREATE INDEX idx_sites_supervisor_id ON public.sites(supervisor_id);
CREATE INDEX idx_sites_submitted_by ON public.sites(submitted_by);

-- ── site_details ──────────────────────────────────────────────────────────────
CREATE TABLE public.site_details (
  id                    uuid NOT NULL DEFAULT uuid_generate_v4(),
  site_id               uuid NOT NULL UNIQUE,
  tenant_id             uuid NOT NULL,
  rent_type             text,                    -- rent_type enum retired (202606141)
  carpet_area_sqft      numeric,
  estimated_monthly_sales numeric,
  score                 numeric,
  fixed_rent_amt        numeric,
  escalation_pct        numeric,
  brokerage             numeric,
  rev_share_pct         numeric,
  cam_charges           numeric,
  security_deposit      numeric,
  capex                 numeric,
  lock_in_months        integer,
  tenure_months         integer,
  rent_free_days        integer,
  nearest_starbucks_m   integer,
  nearest_twc_m         integer,
  escalation_date       date,                    -- added for Launch Approval flow (202606094)
  created_at            timestamp with time zone NOT NULL DEFAULT now(),
  updated_at            timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT site_details_pkey PRIMARY KEY (id),
  CONSTRAINT site_details_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id),
  CONSTRAINT site_details_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT chk_site_details_rent_type CHECK (
      rent_type IN ('fixed','revshare','mg_revshare','staggered') OR rent_type IS NULL
  ) NOT VALID
);

-- ── site_files ────────────────────────────────────────────────────────────────
CREATE TABLE public.site_files (
  id               uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id        uuid NOT NULL,
  site_id          uuid NOT NULL,
  uploaded_by      uuid NOT NULL,
  file_type        text NOT NULL,                -- enum retired (202606141); see chk_site_files_file_type below
  file_name        text NOT NULL,
  storage_path     text NOT NULL,
  file_size_kb     integer,
  mime_type        text,
  is_primary       boolean DEFAULT false,
  source           text NOT NULL DEFAULT 'manual_upload'::text,
  onedrive_item_id text,
  onedrive_synced_at timestamp with time zone,
  uploaded_at      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT site_files_pkey PRIMARY KEY (id),
  CONSTRAINT site_files_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id),
  CONSTRAINT site_files_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT site_files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id),
  CONSTRAINT chk_site_files_file_type CHECK (
      file_type IN ('loi','photo','quality_audit','excellence','closure')
  ) NOT VALID
);
CREATE INDEX idx_site_files_site_id_type ON public.site_files(site_id, file_type);

-- ── audit_logs ────────────────────────────────────────────────────────────────
CREATE TABLE public.audit_logs (
  id           uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id    uuid NOT NULL,
  site_id      uuid,                             -- nullable FK to sites (added post-initial)
  actor_id     uuid,
  actor_name   text,                             -- denormalised for activity feed rendering
  action       text NOT NULL,
  entity_id    uuid,
  entity_type  text,
  from_status  text,
  to_status    text,
  field_name   text,
  from_value   text,
  to_value     text,
  detail       text,
  old_value    jsonb,
  new_value    jsonb,
  ip_address   text,
  user_agent   text,
  created_at   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT audit_logs_site_id_fkey  FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE,
  CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id)
);
CREATE INDEX idx_audit_logs_site_id_created_at ON public.audit_logs(site_id, created_at);
CREATE INDEX idx_audit_logs_tenant_id_created_at ON public.audit_logs(tenant_id, created_at);

-- ── reversible_actions ───────────────────────────────────────────────────────
-- Before-value snapshots for the whitelisted undoable actions (20260806).
-- The audit log cannot serve this purpose — design records no before-state —
-- so the prior values are captured here at action time, the same shape that
-- makes archive/revive work. A row existing IS the whitelist check.
CREATE TABLE public.reversible_actions (
  id           uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id    uuid NOT NULL,
  site_id      uuid NOT NULL,
  audit_log_id uuid,
  action       text NOT NULL,                    -- 'design_admin_review'
  entity_type  text NOT NULL,                    -- 'design_deliverable'
  entity_id    uuid NOT NULL,
  actor_id     uuid NOT NULL,                    -- original-actor guard
  snapshot     jsonb NOT NULL,                   -- before-values + snapshot_version
  created_at   timestamp with time zone NOT NULL DEFAULT now(),
  consumed_at  timestamp with time zone,         -- NULL = still undoable
  consumed_by  uuid,
  CONSTRAINT reversible_actions_pkey PRIMARY KEY (id),
  CONSTRAINT reversible_actions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT reversible_actions_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE,
  CONSTRAINT reversible_actions_audit_log_id_fkey FOREIGN KEY (audit_log_id) REFERENCES public.audit_logs(id),
  CONSTRAINT reversible_actions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id),
  CONSTRAINT reversible_actions_consumed_by_fkey FOREIGN KEY (consumed_by) REFERENCES public.users(id)
);
CREATE INDEX idx_reversible_actions_site_open ON public.reversible_actions(site_id, consumed_at);
CREATE INDEX idx_reversible_actions_tenant_created ON public.reversible_actions(tenant_id, created_at DESC);

-- ── stage_events ─────────────────────────────────────────────────────────────
CREATE TABLE public.stage_events (
  id          uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id   uuid NOT NULL,
  site_id     uuid NOT NULL,
  actor_id    uuid,
  event_type  text NOT NULL,
  from_status text,                              -- site_status enum retired (202606141)
  to_status   text,                              -- site_status enum retired (202606141)
  actor_role  text,                              -- user_role enum retired (202606141)
  api_route   text,
  source      text DEFAULT 'web'::text,
  metadata    jsonb,
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT stage_events_pkey PRIMARY KEY (id),
  CONSTRAINT stage_events_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id),
  CONSTRAINT stage_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT stage_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id),
  CONSTRAINT chk_stage_events_actor_role CHECK (
      actor_role IN ('business_admin','supervisor','executive','system') OR actor_role IS NULL
  ) NOT VALID
);

-- ── notification_outbox ───────────────────────────────────────────────────────
CREATE TABLE public.notification_outbox (
  id              uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id       uuid NOT NULL,
  site_id         uuid,
  recipient_id    uuid,
  recipient_email text,
  type            text NOT NULL,
  channel         text NOT NULL DEFAULT 'email'::text
                    CHECK (channel IN ('email','slack','in_app')),
  status          text NOT NULL DEFAULT 'pending'::text
                    CHECK (status IN ('pending','sent','failed','skipped')),
  attempts        integer NOT NULL DEFAULT 0,
  subject         text,
  body            text,
  payload         jsonb,
  failed_reason   text,
  sent_at         timestamp with time zone,
  created_at      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT notification_outbox_pkey PRIMARY KEY (id),
  CONSTRAINT notification_outbox_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT notification_outbox_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id),
  CONSTRAINT notification_outbox_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id)
);
CREATE INDEX idx_notification_outbox_status ON public.notification_outbox(status);

-- ── approvals ─────────────────────────────────────────────────────────────────
CREATE TABLE public.approvals (
  id                  uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id           uuid NOT NULL,
  site_id             uuid NOT NULL,
  approver_id         uuid NOT NULL,
  status              text NOT NULL DEFAULT 'pending'::text,  -- approval_status enum (separate — not retired by 202606141)
  expected_loi_days   integer,
  loi_deadline        date,
  decided_at          timestamp with time zone,
  rejection_category  text,
  rejection_reason    text,
  notes               text,
  created_at          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT approvals_pkey PRIMARY KEY (id),
  CONSTRAINT approvals_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id),
  CONSTRAINT approvals_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT approvals_approver_id_fkey FOREIGN KEY (approver_id) REFERENCES public.users(id)
);
CREATE INDEX idx_approvals_site_created ON public.approvals(site_id, created_at DESC);
CREATE INDEX idx_approvals_approver_id ON public.approvals(approver_id);

-- ── shortlist_delegations ─────────────────────────────────────────────────────
CREATE TABLE public.shortlist_delegations (
  id               uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id        uuid NOT NULL,
  site_id          uuid NOT NULL,
  delegate_user_id uuid NOT NULL,
  granted_by       uuid NOT NULL,
  granted_at       timestamp with time zone NOT NULL DEFAULT now(),
  revoked_at       timestamp with time zone,
  revoked_by       uuid,
  notes            text,
  CONSTRAINT shortlist_delegations_pkey PRIMARY KEY (id),
  CONSTRAINT shortlist_delegations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT shortlist_delegations_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE,
  CONSTRAINT shortlist_delegations_delegate_user_id_fkey FOREIGN KEY (delegate_user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT shortlist_delegations_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id),
  CONSTRAINT shortlist_delegations_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id)
);

-- ── site_delegations ──────────────────────────────────────────────────────────
CREATE TABLE public.site_delegations (
  id               uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id        uuid NOT NULL,
  site_id          uuid NOT NULL,
  module           text NOT NULL CHECK (module IN ('bd','legal','design','project','nso','project_excellence','financial_closure')),
  delegate_user_id uuid NOT NULL,
  granted_by       uuid NOT NULL,
  granted_at       timestamp with time zone NOT NULL DEFAULT now(),
  revoked_at       timestamp with time zone,
  revoked_by       uuid,
  notes            text,
  CONSTRAINT site_delegations_pkey PRIMARY KEY (id),
  CONSTRAINT site_delegations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT site_delegations_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE,
  CONSTRAINT site_delegations_delegate_user_id_fkey FOREIGN KEY (delegate_user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT site_delegations_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id),
  CONSTRAINT site_delegations_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id)
);

-- ── business_admins ───────────────────────────────────────────────────────────
CREATE TABLE public.business_admins (
  user_id     uuid NOT NULL,
  tenant_id   uuid NOT NULL,
  promoted_at timestamp with time zone NOT NULL DEFAULT now(),
  notes       text,
  CONSTRAINT business_admins_pkey PRIMARY KEY (user_id),
  CONSTRAINT business_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT business_admins_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE
);

-- ── module_codes ──────────────────────────────────────────────────────────────
CREATE TABLE public.module_codes (
  id         uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id  uuid NOT NULL,
  module     text NOT NULL,
  code       text NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  rotated_at timestamp with time zone,
  revoked_at timestamp with time zone,
  CONSTRAINT chk_module_codes_module CHECK (module IN ('bd','legal','design','project','nso','payment','project_excellence')),
  CONSTRAINT module_codes_pkey PRIMARY KEY (id),
  CONSTRAINT module_codes_tenant_module_key UNIQUE (tenant_id, module),
  CONSTRAINT module_codes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT module_codes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id)
);

-- ── supervisor_invite_codes ───────────────────────────────────────────────────
CREATE TABLE public.supervisor_invite_codes (
  id            uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id     uuid NOT NULL,
  supervisor_id uuid NOT NULL,
  module        text NOT NULL CHECK (module IN ('bd','legal','design','project','nso','project_excellence')),
  code          text NOT NULL UNIQUE,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  rotated_at    timestamp with time zone,
  revoked_at    timestamp with time zone,
  CONSTRAINT supervisor_invite_codes_pkey PRIMARY KEY (id),
  CONSTRAINT supervisor_invite_codes_supervisor_module_key UNIQUE (supervisor_id, module),
  CONSTRAINT supervisor_invite_codes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT supervisor_invite_codes_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES public.users(id) ON DELETE CASCADE
);

-- ── user_module_memberships ───────────────────────────────────────────────────
CREATE TABLE public.user_module_memberships (
  id            uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id     uuid NOT NULL,
  user_id       uuid NOT NULL,
  module        text NOT NULL CHECK (module IN ('bd','legal','design','project','nso','project_excellence')),
  role_in_module text NOT NULL CHECK (role_in_module IN ('supervisor','executive')),
  supervisor_id uuid,
  joined_at     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_module_memberships_pkey PRIMARY KEY (id),
  CONSTRAINT user_module_memberships_user_module_key UNIQUE (user_id, module),
  CONSTRAINT user_module_memberships_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT user_module_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT user_module_memberships_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES public.users(id) ON DELETE SET NULL
);

-- ── workspace_requests ────────────────────────────────────────────────────────
-- Added by migration 202605221. Captures landing-page demo/onboarding requests.
CREATE TABLE public.workspace_requests (
  id                    uuid NOT NULL DEFAULT uuid_generate_v4(),
  company               text NOT NULL,
  admin_email           text NOT NULL,
  team_size             text,
  seat_limit            integer NOT NULL DEFAULT 10,
  status                text NOT NULL DEFAULT 'pending'::text
                          CHECK (status IN ('pending','approved','rejected')),
  notes                 text,
  decided_at            timestamp with time zone,
  decided_by            uuid REFERENCES public.users(id),
  provisioned_tenant_id uuid REFERENCES public.tenants(id),
  source_ip             inet,
  created_at            timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT workspace_requests_pkey PRIMARY KEY (id)
);
CREATE INDEX workspace_requests_status_created_idx ON public.workspace_requests(status, created_at DESC);
CREATE INDEX workspace_requests_admin_email_idx ON public.workspace_requests(lower(admin_email));

-- ── password_reset_requests ───────────────────────────────────────────────────
-- Added by migration 202606081. Routed to the PLATFORM admin.
CREATE TABLE public.password_reset_requests (
  id           uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES public.users(id) ON DELETE CASCADE,
  email        text NOT NULL,
  status       text NOT NULL DEFAULT 'pending'::text
                 CHECK (status IN ('pending','approved','completed','rejected')),
  created_at   timestamp with time zone NOT NULL DEFAULT now(),
  approved_at  timestamp with time zone,
  completed_at timestamp with time zone,
  CONSTRAINT password_reset_requests_pkey PRIMARY KEY (id)
);
CREATE INDEX idx_pwd_reset_status ON public.password_reset_requests(status);
CREATE INDEX idx_pwd_reset_tenant_email ON public.password_reset_requests(tenant_id, lower(email));

-- ── legal_dd_checklist ────────────────────────────────────────────────────────
-- 1:1 with sites. Added by migration 202605268.
CREATE TABLE public.legal_dd_checklist (
  site_id          uuid NOT NULL,
  title_doc        text NOT NULL DEFAULT 'pending' CHECK (title_doc        IN ('pending','yes','no','na')),
  sanctioned_plan  text NOT NULL DEFAULT 'pending' CHECK (sanctioned_plan  IN ('pending','yes','no','na')),
  oc_cc            text NOT NULL DEFAULT 'pending' CHECK (oc_cc            IN ('pending','yes','no','na')),
  commercial_use   text NOT NULL DEFAULT 'pending' CHECK (commercial_use   IN ('pending','yes','no','na')),
  property_tax     text NOT NULL DEFAULT 'pending' CHECK (property_tax     IN ('pending','yes','no','na')),
  electricity      text NOT NULL DEFAULT 'pending' CHECK (electricity      IN ('pending','yes','no','na')),
  fire_noc         text NOT NULL DEFAULT 'pending' CHECK (fire_noc         IN ('pending','yes','no','na')),
  other_1          text NOT NULL DEFAULT 'pending' CHECK (other_1          IN ('pending','yes','no','na')),
  other_2          text NOT NULL DEFAULT 'pending' CHECK (other_2          IN ('pending','yes','no','na')),
  other_1_label    text,                           -- custom label for the free-form slot
  other_2_label    text,
  final_verdict    text NOT NULL DEFAULT 'pending' CHECK (final_verdict    IN ('pending','positive','negative')),
  rejection_reason text,
  stage            text NOT NULL DEFAULT 'published'
                     CHECK (stage IN ('draft','pending_review','published')),
  reviewed_by      uuid REFERENCES public.users(id),
  approved_by      uuid REFERENCES public.users(id),
  updated_at       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT legal_dd_checklist_pkey PRIMARY KEY (site_id),
  CONSTRAINT legal_dd_checklist_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE
);
CREATE INDEX idx_legal_dd_checklist_stage ON public.legal_dd_checklist(stage);

-- ── site_agreement ────────────────────────────────────────────────────────────
-- 1:1 with sites. Added by migration 202605268.
CREATE TABLE public.site_agreement (
  site_id       uuid NOT NULL,
  signed        boolean NOT NULL DEFAULT false,
  signed_at     timestamp with time zone,
  registered    boolean NOT NULL DEFAULT false,
  registered_at timestamp with time zone,
  document_url  text,
  CONSTRAINT site_agreement_pkey PRIMARY KEY (site_id),
  CONSTRAINT site_agreement_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE
);

-- ── site_licensing ────────────────────────────────────────────────────────────
-- 1:1 with sites. Added by migration 202605268.
CREATE TABLE public.site_licensing (
  site_id         uuid NOT NULL,
  fssai           text NOT NULL DEFAULT 'pending' CHECK (fssai           IN ('pending','yes','no','na')),
  health_trade    text NOT NULL DEFAULT 'pending' CHECK (health_trade    IN ('pending','yes','no','na')),
  shops_estab_reg text NOT NULL DEFAULT 'pending' CHECK (shops_estab_reg IN ('pending','yes','no','na')),
  fire_noc        text NOT NULL DEFAULT 'pending' CHECK (fire_noc        IN ('pending','yes','no','na')),
  storage_license text NOT NULL DEFAULT 'pending' CHECK (storage_license IN ('pending','yes','no','na')),
  stage           text NOT NULL DEFAULT 'published'
                    CHECK (stage IN ('draft','pending_review','published')),
  updated_at      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT site_licensing_pkey PRIMARY KEY (site_id),
  CONSTRAINT site_licensing_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE
);
CREATE INDEX idx_site_licensing_stage ON public.site_licensing(stage);

-- ── legal_change_requests ─────────────────────────────────────────────────────
-- BD opens "flip this No back to Yes" tickets. Added by migration 202605269.
CREATE TABLE public.legal_change_requests (
  id              uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id       uuid NOT NULL,
  site_id         uuid NOT NULL,
  target_table    text NOT NULL
                    CHECK (target_table IN ('legal_dd_checklist','site_agreement','site_licensing')),
  field_name      text NOT NULL,
  current_value   text NOT NULL,
  requested_value text NOT NULL,
  justification   text,
  requested_by    uuid NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected')),
  reviewed_by     uuid REFERENCES public.users(id),
  reviewer_note   text,
  created_at      timestamp with time zone NOT NULL DEFAULT now(),
  updated_at      timestamp with time zone NOT NULL DEFAULT now(),
  reviewed_at     timestamp with time zone,
  CONSTRAINT legal_change_requests_pkey PRIMARY KEY (id),
  CONSTRAINT lcr_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT lcr_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE,
  CONSTRAINT lcr_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id)
);
CREATE INDEX idx_lcr_tenant_status ON public.legal_change_requests(tenant_id, status);
CREATE INDEX idx_lcr_site ON public.legal_change_requests(site_id);
CREATE INDEX idx_lcr_requested_by ON public.legal_change_requests(requested_by);

-- ── design_reviews ────────────────────────────────────────────────────────────
-- 1:1 with sites — the design "folder". Opens once legal_dd_status='positive'.
CREATE TABLE public.design_reviews (
  site_id          uuid NOT NULL,
  tenant_id        uuid NOT NULL,
  current_stage    text NOT NULL DEFAULT 'recce'
                     CHECK (current_stage IN ('recce','2d','3d','boq','gfc','done')),
  gfc_status       text NOT NULL DEFAULT 'pending'
                     CHECK (gfc_status IN ('pending','approved','rejected')),
  gfc_comments     text,
  gfc_decided_by   uuid REFERENCES public.users(id),
  gfc_decided_at   timestamp with time zone,
  reviewed_by      uuid REFERENCES public.users(id),
  approved_by      uuid REFERENCES public.users(id),
  created_at       timestamp with time zone NOT NULL DEFAULT now(),
  updated_at       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT design_reviews_pkey PRIMARY KEY (site_id),
  CONSTRAINT design_reviews_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE,
  CONSTRAINT design_reviews_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE
);
CREATE INDEX idx_design_reviews_tenant ON public.design_reviews(tenant_id);

-- ── design_deliverables ───────────────────────────────────────────────────────
-- One row per (site, kind). Each deliverable runs its own exec-upload → supervisor-review loop.
CREATE TABLE public.design_deliverables (
  id                  uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id           uuid NOT NULL,
  site_id             uuid NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('recce','2d','3d','boq')),
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','submitted','approved','rejected')),
  file_url            text,
  file_name           text,
  estimated_amount    numeric(14,2),
  supervisor_comments text,
  submitted_by        uuid REFERENCES public.users(id),
  submitted_at        timestamp with time zone,
  reviewed_by         uuid REFERENCES public.users(id),
  reviewed_at         timestamp with time zone,
  admin_status        text NOT NULL DEFAULT 'pending'
                        CHECK (admin_status IN ('pending','approved','rejected')),
  admin_comments      text,
  admin_reviewed_by   uuid REFERENCES public.users(id),
  admin_reviewed_at   timestamp with time zone,
  created_at          timestamp with time zone NOT NULL DEFAULT now(),
  updated_at          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT design_deliverables_pkey PRIMARY KEY (id),
  CONSTRAINT design_deliverables_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE,
  CONSTRAINT design_deliverables_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT uq_design_deliverable_site_kind UNIQUE (site_id, kind)
);
CREATE INDEX idx_design_deliverables_site ON public.design_deliverables(site_id);

-- ── project_reviews ───────────────────────────────────────────────────────────
-- 1:1 with sites. Added by migration 202606033.
CREATE TABLE public.project_reviews (
  site_id                      uuid NOT NULL,
  tenant_id                    uuid NOT NULL,
  project_status               text NOT NULL DEFAULT 'pending'
                                 CHECK (project_status IN ('pending','allocated','budgeting','in_progress','done')),
  current_stage                text NOT NULL DEFAULT 'budget'
                                 CHECK (current_stage IN ('budget','execution','done')),
  allocated_to                 uuid,
  budget_status                text NOT NULL DEFAULT 'draft'
                                 CHECK (budget_status IN ('draft','pending_supervisor','pending_admin','approved','rejected')),
  budget_total                 numeric(14,2),
  total_indoor_area_sqft       numeric(12,2),
  total_area_sqft              numeric(12,2),
  covers                       integer,
  budget_supervisor_comments   text,
  budget_admin_comments        text,
  initialization_date          date,
  initialization_status        text NOT NULL DEFAULT 'pending'
                                 CHECK (initialization_status IN ('pending','proposed','submitted','approved','rejected')),
  initialization_comments      text,
  expected_completion_date     date,
  expected_completion_status   text NOT NULL DEFAULT 'pending'
                                 CHECK (expected_completion_status IN ('pending','submitted','approved','rejected')),
  expected_completion_comments text,
  mid_project_visit_date       date,
  inspection_date              date,
  quality_audit_status         text NOT NULL DEFAULT 'pending'
                                 CHECK (quality_audit_status IN ('pending','submitted','supervisor_approved','approved','rejected')),
  quality_audit_comments       text,
  quality_audit_supervisor_approved_at timestamp with time zone,
  quality_audit_supervisor_approved_by uuid REFERENCES public.users(id),
  quality_audit_admin_confirmed_at timestamp with time zone,
  quality_audit_admin_confirmed_by uuid REFERENCES public.users(id),
  quality_audit_admin_notes    text,
  final_completion_date        date,
  project_completed_at         timestamp with time zone,
  nso_status                   text NOT NULL DEFAULT 'pending'
                                 CHECK (nso_status IN ('pending','pushed')),
  pushed_to_nso_at             timestamp with time zone,
  created_at                   timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT project_reviews_pkey PRIMARY KEY (site_id),
  CONSTRAINT project_reviews_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE,
  CONSTRAINT project_reviews_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT project_reviews_allocated_to_fkey FOREIGN KEY (allocated_to) REFERENCES public.users(id)
);
CREATE INDEX idx_project_reviews_tenant_status ON public.project_reviews(tenant_id, project_status);
CREATE INDEX idx_project_reviews_budget_status ON public.project_reviews(tenant_id, budget_status);

-- ── site_budgets ───────────────────────────────────────────────────────────────
CREATE TABLE public.site_budgets (
  id            uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id     uuid NOT NULL,
  site_id       uuid NOT NULL,
  phase         text NOT NULL,
  status        text NOT NULL DEFAULT 'draft',
  allocated_to  uuid,
  budget_total  numeric(14,2),
  total_indoor_area_sqft numeric(12,2),
  total_area_sqft numeric(12,2),
  covers        integer,
  supervisor_comments text,
  admin_comments text,
  approved_at   timestamp with time zone,
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  updated_at    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT site_budgets_pkey PRIMARY KEY (id),
  CONSTRAINT site_budgets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT site_budgets_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE,
  CONSTRAINT site_budgets_allocated_to_fkey FOREIGN KEY (allocated_to) REFERENCES public.users(id),
  CONSTRAINT chk_site_budget_phase  CHECK (phase IN ('gfc','closure')),
  CONSTRAINT chk_site_budget_status CHECK (status IN ('draft','pending_supervisor','pending_admin','approved','rejected')),
  CONSTRAINT uq_site_budget_site_phase UNIQUE (site_id, phase)
);
CREATE INDEX idx_site_budgets_tenant_phase_status ON public.site_budgets (tenant_id, phase, status);
CREATE INDEX idx_site_budgets_site ON public.site_budgets (site_id);

-- ── site_budget_items ──────────────────────────────────────────────────────────
CREATE TABLE public.site_budget_items (
  id          uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id   uuid NOT NULL,
  site_id     uuid NOT NULL,
  budget_id   uuid NOT NULL,
  phase       text NOT NULL,
  idx         integer NOT NULL,
  label       text,
  amount      numeric(14,2),
  created_at  timestamp with time zone NOT NULL DEFAULT now(),
  updated_at  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT site_budget_items_pkey PRIMARY KEY (id),
  CONSTRAINT site_budget_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT site_budget_items_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE,
  CONSTRAINT site_budget_items_budget_id_fkey FOREIGN KEY (budget_id) REFERENCES public.site_budgets(id) ON DELETE CASCADE,
  CONSTRAINT chk_site_budget_item_phase CHECK (phase IN ('gfc','closure')),
  CONSTRAINT chk_site_budget_item_idx   CHECK (idx BETWEEN 1 AND 11),
  CONSTRAINT uq_site_budget_item_budget_idx UNIQUE (budget_id, idx)
);
CREATE INDEX idx_site_budget_items_site_phase ON public.site_budget_items (site_id, phase);
CREATE INDEX idx_site_budget_items_budget ON public.site_budget_items (budget_id);

-- ── nso_reviews ───────────────────────────────────────────────────────────────
-- 1:1 with sites. Added by migration 20260609.
CREATE TABLE public.nso_reviews (
  site_id                  uuid NOT NULL,
  tenant_id                uuid NOT NULL,
  current_stage            text NOT NULL DEFAULT 'stage_one'
                             CHECK (current_stage IN ('stage_one','stage_two','stage_three','final','done')),
  nso_status               text NOT NULL DEFAULT 'pending'
                             CHECK (nso_status IN ('pending','in_progress','complete')),
  property_details         text,
  communication_floated    boolean,
  fssai_status             text NOT NULL DEFAULT 'pending' CHECK (fssai_status         IN ('pending','done')),
  health_trade_status      text NOT NULL DEFAULT 'pending' CHECK (health_trade_status  IN ('pending','done')),
  shops_estab_status       text NOT NULL DEFAULT 'pending' CHECK (shops_estab_status   IN ('pending','done')),
  fire_noc_status          text NOT NULL DEFAULT 'pending' CHECK (fire_noc_status      IN ('pending','done')),
  storage_license_status   text NOT NULL DEFAULT 'pending' CHECK (storage_license_status IN ('pending','done')),
  dry_stock_order_status   text NOT NULL DEFAULT 'pending'
                             CHECK (dry_stock_order_status IN ('pending','ordered','received')),
  online_delivery_status   text NOT NULL DEFAULT 'pending'
                             CHECK (online_delivery_status IN ('pending','ready','active')),
  handover_checklist_signed boolean,
  launch_date              date,
  launch_ready             boolean,
  final_approval_signoff_1 boolean NOT NULL DEFAULT false,
  final_approval_signoff_2 boolean NOT NULL DEFAULT false,
  stage_one_completed_at   timestamp with time zone,
  stage_two_completed_at   timestamp with time zone,
  stage_three_completed_at timestamp with time zone,
  final_approved_at        timestamp with time zone,
  handover_pushed_at       timestamp with time zone,
  created_at               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at               timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT nso_reviews_pkey PRIMARY KEY (site_id),
  CONSTRAINT nso_reviews_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE,
  CONSTRAINT nso_reviews_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE
);
CREATE INDEX idx_nso_reviews_tenant_status ON public.nso_reviews(tenant_id, nso_status);

-- ── launch_approvals ──────────────────────────────────────────────────────────
-- Post-NSO validation loop. Added by migrations 202606094 + 202606121.
CREATE TABLE public.launch_approvals (
  id                      uuid NOT NULL DEFAULT uuid_generate_v4(),
  site_id                 uuid NOT NULL UNIQUE,
  tenant_id               uuid NOT NULL,
  -- Editable commercial snapshot (pre-populated from site_details + sites)
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
  -- FSM: pending_admin_review → under_exec_review → under_supervisor_review
  --       → pending_admin_final → ready_to_launch → launched
  status                  text NOT NULL DEFAULT 'pending_admin_review'
                            CHECK (status IN (
                              'pending_admin_review','under_exec_review',
                              'under_supervisor_review','pending_admin_final',
                              'ready_to_launch','launched'
                            )),
  -- Validation loop actors / verdicts (migration 202606121)
  admin_review_comment        text,
  admin_sent_for_review_at    timestamp with time zone,
  admin_sent_for_review_by    uuid REFERENCES public.users(id),
  exec_verdict                text CHECK (exec_verdict IS NULL OR exec_verdict IN ('approved','rejected')),
  exec_comment                text,
  exec_reviewed_at            timestamp with time zone,
  exec_reviewed_by            uuid REFERENCES public.users(id),
  supervisor_verdict          text CHECK (supervisor_verdict IS NULL OR supervisor_verdict IN ('approved','rejected')),
  supervisor_comment          text,
  supervisor_reviewed_at      timestamp with time zone,
  supervisor_reviewed_by      uuid REFERENCES public.users(id),
  admin_final_comment         text,
  admin_confirmed_at          timestamp with time zone,
  admin_confirmed_by          uuid REFERENCES public.users(id),
  committed_at                timestamp with time zone,
  launched_at                 timestamp with time zone,
  launched_by                 uuid REFERENCES public.users(id),
  -- Legacy approve-only ladder columns (pre-202606121) — kept nullable for back-compat
  admin_approved_at           timestamp with time zone,
  admin_approved_by           uuid REFERENCES public.users(id),
  bd_confirmed_at             timestamp with time zone,
  bd_confirmed_by             uuid REFERENCES public.users(id),
  supervisor_approved_at      timestamp with time zone,
  supervisor_approved_by      uuid REFERENCES public.users(id),
  super_admin_approved_at     timestamp with time zone,
  super_admin_approved_by     uuid REFERENCES public.users(id),
  created_at                  timestamp with time zone NOT NULL DEFAULT now(),
  updated_at                  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT launch_approvals_pkey PRIMARY KEY (id),
  CONSTRAINT launch_approvals_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE,
  CONSTRAINT launch_approvals_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE
);
CREATE INDEX idx_launch_approvals_tenant_status ON public.launch_approvals(tenant_id, status);

-- ── launch_review_events ──────────────────────────────────────────────────────
-- Append-only timeline for the launch validation loop (migration 202606121).
CREATE TABLE public.launch_review_events (
  id                  uuid NOT NULL DEFAULT uuid_generate_v4(),
  launch_approval_id  uuid NOT NULL,
  site_id             uuid NOT NULL,
  tenant_id           uuid NOT NULL,
  actor_id            uuid REFERENCES public.users(id),
  actor_name          text,
  actor_role          text,
  stage               text NOT NULL,
  action              text NOT NULL,
  comment             text,
  changes             jsonb,
  created_at          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT launch_review_events_pkey PRIMARY KEY (id),
  CONSTRAINT lre_launch_approval_id_fkey FOREIGN KEY (launch_approval_id) REFERENCES public.launch_approvals(id) ON DELETE CASCADE,
  CONSTRAINT lre_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE,
  CONSTRAINT lre_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE
);
CREATE INDEX idx_launch_review_events_approval ON public.launch_review_events(launch_approval_id, created_at);
-- Add has_executive_access to user_module_memberships
ALTER TABLE public.user_module_memberships
  ADD COLUMN has_executive_access boolean NOT NULL DEFAULT false;

-- Create supervisor_executive_requests table
CREATE TABLE public.supervisor_executive_requests (
  id            uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id     uuid NOT NULL,
  supervisor_id uuid NOT NULL,
  module        text NOT NULL CHECK (module IN ('bd','legal','design','project','nso','project_excellence')),
  status        text NOT NULL DEFAULT 'pending'::text CHECK (status IN ('pending','approved','rejected')),
  created_at    timestamp with time zone NOT NULL DEFAULT now(),
  decided_at    timestamp with time zone,
  decided_by    uuid,
  CONSTRAINT supervisor_executive_requests_pkey PRIMARY KEY (id),
  CONSTRAINT supervisor_executive_requests_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT supervisor_executive_requests_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT supervisor_executive_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES public.users(id) ON DELETE SET NULL
);

-- Ensure a supervisor can only have one pending request per module at a time
CREATE UNIQUE INDEX idx_supervisor_executive_requests_pending
  ON public.supervisor_executive_requests (supervisor_id, module)
  WHERE status = 'pending';

-- Index for querying requests efficiently
CREATE INDEX idx_supervisor_executive_requests_tenant_status
  ON public.supervisor_executive_requests (tenant_id, status);
