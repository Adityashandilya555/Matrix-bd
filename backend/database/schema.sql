-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.approvals (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  status USER-DEFINED NOT NULL DEFAULT 'pending'::approval_status,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  loi_deadline date,
  site_id uuid NOT NULL,
  decided_at timestamp with time zone,
  approver_id uuid NOT NULL,
  expected_loi_days integer,
  rejection_category text,
  tenant_id uuid NOT NULL,
  notes text,
  rejection_reason text,
  CONSTRAINT approvals_pkey PRIMARY KEY (id),
  CONSTRAINT approvals_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id),
  CONSTRAINT approvals_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT approvals_approver_id_fkey FOREIGN KEY (approver_id) REFERENCES public.users(id)
);
CREATE TABLE public.audit_logs (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  tenant_id uuid NOT NULL,
  user_agent text,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  new_value jsonb,
  actor_id uuid,
  old_value jsonb,
  ip_address text,
  entity_type text NOT NULL,
  CONSTRAINT audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id)
);
CREATE TABLE public.notification_outbox (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  channel text NOT NULL DEFAULT 'email'::text,
  status text NOT NULL DEFAULT 'pending'::text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  recipient_id uuid,
  body text,
  recipient_email text,
  site_id uuid,
  failed_reason text,
  subject text,
  sent_at timestamp with time zone,
  type text NOT NULL,
  payload jsonb,
  tenant_id uuid NOT NULL,
  CONSTRAINT notification_outbox_pkey PRIMARY KEY (id),
  CONSTRAINT notification_outbox_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT notification_outbox_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id),
  CONSTRAINT notification_outbox_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES public.users(id)
);
CREATE TABLE public.site_details (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  completion_pct integer DEFAULT ((((((((((
CASE
    WHEN (carpet_area_sqft IS NOT NULL) THEN 1
    ELSE 0
END +
CASE
    WHEN (estimated_monthly_sales IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (capex IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (security_deposit IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (score IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (rent_type IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (fixed_rent_amt IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (nearest_starbucks_m IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (lock_in_months IS NOT NULL) THEN 1
    ELSE 0
END) +
CASE
    WHEN (tenure_months IS NOT NULL) THEN 1
    ELSE 0
END) * 10),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  site_id uuid NOT NULL UNIQUE,
  rent_type USER-DEFINED,
  cam_charges numeric,
  nearest_starbucks_m integer,
  brokerage numeric,
  rev_share_pct numeric,
  tenure_months integer,
  fixed_rent_amt numeric,
  escalation_pct numeric,
  nearest_twc_m integer,
  capex numeric,
  estimated_monthly_sales numeric,
  security_deposit numeric,
  tenant_id uuid NOT NULL,
  rent_free_days integer,
  lock_in_months integer,
  carpet_area_sqft numeric,
  score numeric,
  CONSTRAINT site_details_pkey PRIMARY KEY (id),
  CONSTRAINT site_details_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id),
  CONSTRAINT site_details_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.site_files (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  source USER-DEFINED NOT NULL DEFAULT 'manual_upload'::file_source,
  is_primary boolean DEFAULT false,
  uploaded_at timestamp with time zone NOT NULL DEFAULT now(),
  file_name text NOT NULL,
  file_size_kb integer,
  tenant_id uuid NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  uploaded_by uuid NOT NULL,
  onedrive_item_id text,
  site_id uuid NOT NULL,
  onedrive_synced_at timestamp with time zone,
  file_type USER-DEFINED NOT NULL,
  CONSTRAINT site_files_pkey PRIMARY KEY (id),
  CONSTRAINT site_files_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id),
  CONSTRAINT site_files_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT site_files_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id)
);
CREATE TABLE public.sites (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  status USER-DEFINED NOT NULL DEFAULT 'draft_submitted'::site_status,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  draft_submitted_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  code text,
  name text NOT NULL,
  archive_note text,
  address text,
  city text NOT NULL,
  google_maps_pin text,
  google_maps_url text,
  expected_rent numeric(12,2),
  rent_type text,
  expected_escalation_pct numeric(6,2),
  expected_escalation_years integer,
  expected_revshare_pct numeric(6,2),
  rent_set_at timestamp with time zone,
  spoc_email text,
  submitted_by uuid NOT NULL,
  pushed_to_payments_at timestamp with time zone,
  rejected_at timestamp with time zone,
  assigned_to uuid,
  tenant_id uuid NOT NULL,
  shortlisted_at timestamp with time zone,
  visit_date date,
  spoc_name text,
  model USER-DEFINED,
  rejection_reason text,
  notes text,
  approved_at timestamp with time zone,
  archived_at timestamp with time zone,
  details_submitted_at timestamp with time zone,
  supervisor_id uuid,
  loi_uploaded_at timestamp with time zone,
  legal_review_at timestamp with time zone,
  legal_approved_at timestamp with time zone,
  legal_rejected_at timestamp with time zone,
  legal_dd_status text DEFAULT 'pending'::text,
  agreement_status text DEFAULT 'pending'::text,
  licensing_status text DEFAULT 'pending'::text,
  design_status text DEFAULT 'pending'::text,
  design_approved_at timestamp with time zone,
  kyc_verified boolean NOT NULL DEFAULT false,
  ca_code text,
  finance_amount numeric(14,2),
  finance_status text NOT NULL DEFAULT 'pending'::text,
  spoc_phone text,
  archived_from_status text,
  CONSTRAINT sites_pkey PRIMARY KEY (id),
  CONSTRAINT sites_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT sites_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(id),
  CONSTRAINT sites_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.users(id),
  CONSTRAINT sites_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES public.users(id),
  CONSTRAINT chk_sites_rent_type CHECK ((rent_type = ANY (ARRAY['fixed'::text, 'revshare'::text, 'mg_revshare'::text])) OR (rent_type IS NULL))
);
CREATE TABLE public.stage_events (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  source text DEFAULT 'web'::text,
  occurred_at timestamp with time zone NOT NULL DEFAULT now(),
  actor_id uuid,
  tenant_id uuid NOT NULL,
  to_status USER-DEFINED,
  api_route text,
  actor_role USER-DEFINED,
  from_status USER-DEFINED,
  event_type text NOT NULL,
  metadata jsonb,
  site_id uuid NOT NULL,
  CONSTRAINT stage_events_pkey PRIMARY KEY (id),
  CONSTRAINT stage_events_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id),
  CONSTRAINT stage_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT stage_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id)
);
CREATE TABLE public.tenants (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  plan text NOT NULL DEFAULT 'standard'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  seat_limit integer NOT NULL DEFAULT 10,
  workspace_code text NOT NULL,
  CONSTRAINT tenants_pkey PRIMARY KEY (id)
);
CREATE TABLE public.users (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  role text NOT NULL DEFAULT 'executive'::text CHECK (role IN ('business_admin','supervisor','executive')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  email text NOT NULL,
  name text NOT NULL,
  tenant_id uuid NOT NULL,
  assigned_city text,
  notes text,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_tenant_id_email_key UNIQUE (tenant_id, email),
  CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.shortlist_delegations (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  site_id uuid NOT NULL,
  delegate_user_id uuid NOT NULL,
  granted_by uuid NOT NULL,
  granted_at timestamp with time zone NOT NULL DEFAULT now(),
  revoked_at timestamp with time zone,
  revoked_by uuid,
  notes text,
  CONSTRAINT shortlist_delegations_pkey PRIMARY KEY (id),
  CONSTRAINT shortlist_delegations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT shortlist_delegations_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE,
  CONSTRAINT shortlist_delegations_delegate_user_id_fkey FOREIGN KEY (delegate_user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT shortlist_delegations_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id),
  CONSTRAINT shortlist_delegations_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id)
);
CREATE TABLE IF NOT EXISTS public.business_admins (
  user_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  promoted_at timestamp with time zone NOT NULL DEFAULT now(),
  notes text,
  CONSTRAINT business_admins_pkey PRIMARY KEY (user_id),
  CONSTRAINT business_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT business_admins_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.module_codes (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  module text NOT NULL CHECK (module IN ('bd','legal','payment','design','project')),
  code text NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  rotated_at timestamp with time zone,
  revoked_at timestamp with time zone,
  CONSTRAINT module_codes_pkey PRIMARY KEY (id),
  CONSTRAINT module_codes_tenant_module_key UNIQUE (tenant_id, module),
  CONSTRAINT module_codes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT module_codes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id)
);
CREATE TABLE IF NOT EXISTS public.supervisor_invite_codes (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  supervisor_id uuid NOT NULL,
  module text NOT NULL CHECK (module IN ('bd','legal','payment','design','project')),
  code text NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  rotated_at timestamp with time zone,
  revoked_at timestamp with time zone,
  CONSTRAINT supervisor_invite_codes_pkey PRIMARY KEY (id),
  CONSTRAINT supervisor_invite_codes_supervisor_module_key UNIQUE (supervisor_id, module),
  CONSTRAINT supervisor_invite_codes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT supervisor_invite_codes_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES public.users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.user_module_memberships (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  module text NOT NULL CHECK (module IN ('bd','legal','payment','design','project')),
  role_in_module text NOT NULL CHECK (role_in_module IN ('supervisor','executive')),
  supervisor_id uuid,
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_module_memberships_pkey PRIMARY KEY (id),
  CONSTRAINT user_module_memberships_user_module_key UNIQUE (user_id, module),
  CONSTRAINT user_module_memberships_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT user_module_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT user_module_memberships_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS public.site_delegations (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  site_id uuid NOT NULL,
  module text NOT NULL CHECK (module IN ('bd','legal','payment','design','project')),
  delegate_user_id uuid NOT NULL,
  granted_by uuid NOT NULL,
  granted_at timestamp with time zone NOT NULL DEFAULT now(),
  revoked_at timestamp with time zone,
  revoked_by uuid,
  notes text,
  CONSTRAINT site_delegations_pkey PRIMARY KEY (id),
  CONSTRAINT site_delegations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT site_delegations_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE,
  CONSTRAINT site_delegations_delegate_user_id_fkey FOREIGN KEY (delegate_user_id) REFERENCES public.users(id) ON DELETE CASCADE,
  CONSTRAINT site_delegations_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id),
  CONSTRAINT site_delegations_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.users(id)
);
CREATE TABLE IF NOT EXISTS public.project_reviews (
  site_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  project_status text NOT NULL DEFAULT 'pending',
  current_stage text NOT NULL DEFAULT 'budget',
  allocated_to uuid,
  budget_status text NOT NULL DEFAULT 'draft',
  budget_total numeric(14,2),
  budget_supervisor_comments text,
  budget_admin_comments text,
  initialization_date date,
  initialization_status text NOT NULL DEFAULT 'pending',
  initialization_comments text,
  expected_completion_date date,
  expected_completion_status text NOT NULL DEFAULT 'pending',
  expected_completion_comments text,
  inspection_date date,
  quality_audit_status text NOT NULL DEFAULT 'pending',
  quality_audit_comments text,
  final_completion_date date,
  project_completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT project_reviews_pkey PRIMARY KEY (site_id),
  CONSTRAINT project_reviews_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE,
  CONSTRAINT project_reviews_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT project_reviews_allocated_to_fkey FOREIGN KEY (allocated_to) REFERENCES public.users(id),
  CONSTRAINT chk_project_status CHECK (project_status IN ('pending','allocated','budgeting','in_progress','done')),
  CONSTRAINT chk_project_current_stage CHECK (current_stage IN ('budget','execution','done')),
  CONSTRAINT chk_project_budget_status CHECK (budget_status IN ('draft','pending_supervisor','pending_admin','approved','rejected')),
  CONSTRAINT chk_project_initialization_status CHECK (initialization_status IN ('pending','submitted','approved','rejected')),
  CONSTRAINT chk_project_expected_completion_status CHECK (expected_completion_status IN ('pending','submitted','approved','rejected')),
  CONSTRAINT chk_project_quality_status CHECK (quality_audit_status IN ('pending','submitted','approved','rejected'))
);
CREATE INDEX IF NOT EXISTS idx_project_reviews_tenant_status ON public.project_reviews(tenant_id, project_status);
CREATE INDEX IF NOT EXISTS idx_project_reviews_budget_status ON public.project_reviews(tenant_id, budget_status);
CREATE TABLE IF NOT EXISTS public.project_budget_items (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  site_id uuid NOT NULL,
  idx integer NOT NULL,
  label text,
  amount numeric(14,2),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT project_budget_items_pkey PRIMARY KEY (id),
  CONSTRAINT project_budget_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
  CONSTRAINT project_budget_items_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE,
  CONSTRAINT uq_project_budget_site_idx UNIQUE (site_id, idx),
  CONSTRAINT chk_project_budget_idx CHECK (idx BETWEEN 1 AND 10)
);
CREATE INDEX IF NOT EXISTS idx_project_budget_items_site ON public.project_budget_items(site_id);
