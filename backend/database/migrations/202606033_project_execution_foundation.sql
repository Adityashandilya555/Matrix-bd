-- Project Execution foundation.
-- Design approval is the gate; project work is tracked in child tables so the
-- existing BD/Legal/Finance/Design status contracts remain untouched.

ALTER TABLE IF EXISTS site_delegations
  DROP CONSTRAINT IF EXISTS chk_site_delegations_module;

ALTER TABLE IF EXISTS site_delegations
  ADD CONSTRAINT chk_site_delegations_module
  CHECK (module IN ('bd','legal','payment','design','project'));

ALTER TABLE IF EXISTS module_codes
  DROP CONSTRAINT IF EXISTS module_codes_module_check;

ALTER TABLE IF EXISTS module_codes
  DROP CONSTRAINT IF EXISTS chk_module_codes_module;

ALTER TABLE IF EXISTS module_codes
  ADD CONSTRAINT chk_module_codes_module
  CHECK (module IN ('bd','legal','payment','design','project'));

ALTER TABLE IF EXISTS supervisor_invite_codes
  DROP CONSTRAINT IF EXISTS supervisor_invite_codes_module_check;

ALTER TABLE IF EXISTS supervisor_invite_codes
  DROP CONSTRAINT IF EXISTS chk_supervisor_invite_codes_module;

ALTER TABLE IF EXISTS supervisor_invite_codes
  ADD CONSTRAINT chk_supervisor_invite_codes_module
  CHECK (module IN ('bd','legal','payment','design','project'));

ALTER TABLE IF EXISTS user_module_memberships
  DROP CONSTRAINT IF EXISTS user_module_memberships_module_check;

ALTER TABLE IF EXISTS user_module_memberships
  DROP CONSTRAINT IF EXISTS chk_user_module_memberships_module;

ALTER TABLE IF EXISTS user_module_memberships
  ADD CONSTRAINT chk_user_module_memberships_module
  CHECK (module IN ('bd','legal','payment','design','project'));

CREATE TABLE IF NOT EXISTS project_reviews (
  site_id uuid PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_status text NOT NULL DEFAULT 'pending',
  current_stage text NOT NULL DEFAULT 'budget',
  allocated_to uuid REFERENCES users(id),
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
  project_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_project_status
    CHECK (project_status IN ('pending','allocated','budgeting','in_progress','done')),
  CONSTRAINT chk_project_current_stage
    CHECK (current_stage IN ('budget','execution','done')),
  CONSTRAINT chk_project_budget_status
    CHECK (budget_status IN ('draft','pending_supervisor','pending_admin','approved','rejected')),
  CONSTRAINT chk_project_initialization_status
    CHECK (initialization_status IN ('pending','submitted','approved','rejected')),
  CONSTRAINT chk_project_expected_completion_status
    CHECK (expected_completion_status IN ('pending','submitted','approved','rejected')),
  CONSTRAINT chk_project_quality_status
    CHECK (quality_audit_status IN ('pending','submitted','approved','rejected'))
);

CREATE INDEX IF NOT EXISTS idx_project_reviews_tenant_status
  ON project_reviews (tenant_id, project_status);

CREATE INDEX IF NOT EXISTS idx_project_reviews_budget_status
  ON project_reviews (tenant_id, budget_status);

CREATE TABLE IF NOT EXISTS project_budget_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  idx integer NOT NULL,
  label text,
  amount numeric(14,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_project_budget_site_idx UNIQUE (site_id, idx),
  CONSTRAINT chk_project_budget_idx CHECK (idx BETWEEN 1 AND 10)
);

CREATE INDEX IF NOT EXISTS idx_project_budget_items_site
  ON project_budget_items (site_id);
