-- NSO module: persisted New Store Opening readiness workflow.
-- Adds `nso` to module-aware gates and creates a tenant-scoped NSO review row.

ALTER TABLE module_codes DROP CONSTRAINT IF EXISTS chk_module_codes_module;
ALTER TABLE module_codes DROP CONSTRAINT IF EXISTS module_codes_module_check;
ALTER TABLE module_codes
  ADD CONSTRAINT chk_module_codes_module
  CHECK (module IN ('bd','legal','payment','design','project','nso'));

ALTER TABLE supervisor_invite_codes DROP CONSTRAINT IF EXISTS chk_supervisor_invite_codes_module;
ALTER TABLE supervisor_invite_codes DROP CONSTRAINT IF EXISTS supervisor_invite_codes_module_check;
ALTER TABLE supervisor_invite_codes
  ADD CONSTRAINT chk_supervisor_invite_codes_module
  CHECK (module IN ('bd','legal','payment','design','project','nso'));

ALTER TABLE user_module_memberships DROP CONSTRAINT IF EXISTS chk_user_module_memberships_module;
ALTER TABLE user_module_memberships DROP CONSTRAINT IF EXISTS user_module_memberships_module_check;
ALTER TABLE user_module_memberships
  ADD CONSTRAINT chk_user_module_memberships_module
  CHECK (module IN ('bd','legal','payment','design','project','nso'));

ALTER TABLE site_delegations DROP CONSTRAINT IF EXISTS chk_site_delegations_module;
ALTER TABLE site_delegations DROP CONSTRAINT IF EXISTS site_delegations_module_check;
ALTER TABLE site_delegations
  ADD CONSTRAINT chk_site_delegations_module
  CHECK (module IN ('bd','legal','payment','design','project','nso'));

CREATE TABLE IF NOT EXISTS nso_reviews (
  site_id uuid PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  current_stage text NOT NULL DEFAULT 'stage_one'
    CHECK (current_stage IN ('stage_one','stage_two','stage_three','final','done')),
  nso_status text NOT NULL DEFAULT 'pending'
    CHECK (nso_status IN ('pending','in_progress','complete')),

  property_details text,
  communication_floated boolean,

  fssai_status text NOT NULL DEFAULT 'pending'
    CHECK (fssai_status IN ('pending','done')),
  health_trade_status text NOT NULL DEFAULT 'pending'
    CHECK (health_trade_status IN ('pending','done')),
  shops_estab_status text NOT NULL DEFAULT 'pending'
    CHECK (shops_estab_status IN ('pending','done')),
  fire_noc_status text NOT NULL DEFAULT 'pending'
    CHECK (fire_noc_status IN ('pending','done')),
  storage_license_status text NOT NULL DEFAULT 'pending'
    CHECK (storage_license_status IN ('pending','done')),

  dry_stock_order_status text NOT NULL DEFAULT 'pending'
    CHECK (dry_stock_order_status IN ('pending','ordered','received')),
  online_delivery_status text NOT NULL DEFAULT 'pending'
    CHECK (online_delivery_status IN ('pending','ready','active')),
  handover_checklist_signed boolean,
  launch_date date,
  launch_ready boolean,
  final_approval_signoff_1 boolean NOT NULL DEFAULT false,
  final_approval_signoff_2 boolean NOT NULL DEFAULT false,

  stage_one_completed_at timestamptz,
  stage_two_completed_at timestamptz,
  stage_three_completed_at timestamptz,
  final_approved_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nso_reviews_tenant_status
  ON nso_reviews(tenant_id, nso_status);
