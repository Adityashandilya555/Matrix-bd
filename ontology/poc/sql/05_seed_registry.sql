-- ─────────────────────────────────────────────────────────────────────────────
-- The base ontology package, plus three tenant overlays.
--
--   base                — the product. Every client gets these object types.
--   qsr-overlay         — Tenant B renames things and adds a property, AND runs
--                         a REORDERED approval flow (design before finance).
--   client-erp-overlay  — Tenant C's Site is backed by their own ERP table.
--
-- Overlay authority is add + rename only, never remove (V3 §8 decision 2).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── versions ─────────────────────────────────────────────────────────────────
INSERT INTO ontology.ontology_version (id, tenant_id, package, semver, status, parent_id) VALUES
  ('b0000000-0000-0000-0000-000000000001', NULL,
   'matrix-retail-base', '1.0.0', 'published', NULL),
  ('b0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'qsr-overlay', '1.0.0', 'published', 'b0000000-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333',
   'client-erp-overlay', '1.0.0', 'published', 'b0000000-0000-0000-0000-000000000001');

-- ── BASE: object types ───────────────────────────────────────────────────────
INSERT INTO ontology.object_type (version_id, api_name, display_name, plural, primary_key, implements) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'Site',       'Site',        'Sites',       'id',      '{Approvable,Documented}'),
  ('b0000000-0000-0000-0000-000000000001', 'LegalDD',    'Legal DD',    'Legal DDs',   'site_id', '{}'),
  ('b0000000-0000-0000-0000-000000000001', 'SiteBudget', 'Site Budget', 'Site Budgets','id',      '{Approvable,Budgeted}');

-- ── BASE: properties ─────────────────────────────────────────────────────────
INSERT INTO ontology.property_def
  (version_id, object_type, api_name, display_name, type, required, storage, column_name, constraints) VALUES
  ('b0000000-0000-0000-0000-000000000001','Site','id',             'ID',              'uuid',    true,  'column','id','{}'),
  ('b0000000-0000-0000-0000-000000000001','Site','code',           'Site Code',       'string',  false, 'column','code','{}'),
  ('b0000000-0000-0000-0000-000000000001','Site','name',           'Name',            'string',  true,  'column','name','{}'),
  ('b0000000-0000-0000-0000-000000000001','Site','city',           'City',            'string',  true,  'column','city','{}'),
  ('b0000000-0000-0000-0000-000000000001','Site','status',         'Status',          'string',  true,  'column','status',
    '{"enum":["draft_submitted","shortlisted","details_submitted","approved","loi_uploaded","rejected","archived"]}'),
  ('b0000000-0000-0000-0000-000000000001','Site','legalDdStatus',  'Legal DD Status', 'string',  true,  'column','legal_dd_status',
    '{"enum":["pending","in_review","positive","negative"]}'),
  ('b0000000-0000-0000-0000-000000000001','Site','financeStatus',  'Finance Status',  'string',  true,  'column','finance_status','{}'),
  ('b0000000-0000-0000-0000-000000000001','Site','expectedRent',   'Expected Rent',   'decimal', false, 'column','expected_rent','{}'),
  ('b0000000-0000-0000-0000-000000000001','Site','areaSqft',       'Area (sqft)',     'integer', false, 'column','area_sqft','{}'),

  ('b0000000-0000-0000-0000-000000000001','LegalDD','siteId',        'Site',            'uuid',   true,  'column','site_id','{}'),
  ('b0000000-0000-0000-0000-000000000001','LegalDD','titleDoc',      'Title Document',  'string', true,  'column','title_doc','{"enum":["pending","yes","no","na"]}'),
  ('b0000000-0000-0000-0000-000000000001','LegalDD','sanctionedPlan','Sanctioned Plan', 'string', true,  'column','sanctioned_plan','{"enum":["pending","yes","no","na"]}'),
  ('b0000000-0000-0000-0000-000000000001','LegalDD','finalVerdict',  'Final Verdict',   'string', true,  'column','final_verdict','{"enum":["pending","positive","negative"]}'),
  ('b0000000-0000-0000-0000-000000000001','LegalDD','stage',         'Stage',           'string', true,  'column','stage','{"enum":["draft","pending_review","published"]}'),

  ('b0000000-0000-0000-0000-000000000001','SiteBudget','id',         'ID',           'uuid',    true,  'column','id','{}'),
  ('b0000000-0000-0000-0000-000000000001','SiteBudget','siteId',     'Site',         'uuid',    true,  'column','site_id','{}'),
  ('b0000000-0000-0000-0000-000000000001','SiteBudget','phase',      'Phase',        'string',  true,  'column','phase','{"enum":["gfc","closure"]}'),
  ('b0000000-0000-0000-0000-000000000001','SiteBudget','status',     'Status',       'string',  true,  'column','status',
    '{"enum":["draft","pending_supervisor","pending_admin","approved","rejected"]}'),
  ('b0000000-0000-0000-0000-000000000001','SiteBudget','budgetTotal','Budget Total', 'decimal', false, 'column','budget_total','{}'),
  ('b0000000-0000-0000-0000-000000000001','SiteBudget','covers',     'Covers',       'integer', false, 'column','covers','{}');

-- ── BASE: links (declared over FKs that already exist) ───────────────────────
INSERT INTO ontology.link_type
  (version_id, api_name, from_type, to_type, cardinality, backing, from_column, to_column, display) VALUES
  ('b0000000-0000-0000-0000-000000000001','siteLegalDd','Site','LegalDD',   'one_to_one', 'fk','id','site_id','Legal DD'),
  ('b0000000-0000-0000-0000-000000000001','siteBudgets','Site','SiteBudget','one_to_many','fk','id','site_id','Budgets');

-- ── BASE: interfaces ─────────────────────────────────────────────────────────
INSERT INTO ontology.interface (version_id, api_name, required_properties) VALUES
  ('b0000000-0000-0000-0000-000000000001','Approvable','{status}'),
  ('b0000000-0000-0000-0000-000000000001','Documented','{}'),
  ('b0000000-0000-0000-0000-000000000001','Budgeted',  '{budgetTotal}');

INSERT INTO ontology.interface_impl (version_id, interface_name, object_type, property_mapping) VALUES
  ('b0000000-0000-0000-0000-000000000001','Approvable','Site',      '{"status":"status"}'),
  ('b0000000-0000-0000-0000-000000000001','Approvable','SiteBudget','{"status":"status"}'),
  ('b0000000-0000-0000-0000-000000000001','Budgeted',  'SiteBudget','{"budgetTotal":"budgetTotal"}');

-- ── BASE: actions ────────────────────────────────────────────────────────────
-- design.open reproduces _assert_design_unlocked (design_service.py:229) exactly:
--   site.legal_dd_status == 'positive' AND site.finance_status == 'approved'
-- as data instead of Python.
INSERT INTO ontology.action_type
  (version_id, api_name, object_type, display_name, from_status, to_status,
   preconditions, required_role, required_module, side_effects) VALUES
  ('b0000000-0000-0000-0000-000000000001','design.open','Site','Open Design',
   '{approved,loi_uploaded}', NULL,
   '{"and":[{"==":[{"var":"legal_dd_status"},"positive"]},
            {"==":[{"var":"finance_status"},"approved"]}]}'::jsonb,
   'business_admin','design',
   '[{"kind":"notify","template":"design_unlocked"}]'::jsonb),

  ('b0000000-0000-0000-0000-000000000001','budget.submit','SiteBudget','Submit Budget',
   '{draft}', 'pending_supervisor',
   '{"!=":[{"var":"budget_total"},null]}'::jsonb,
   'executive','project',
   '[{"kind":"notify","template":"budget_submitted"}]'::jsonb);

-- ── BASE: datasource bindings (kind=native) ─────────────────────────────────
INSERT INTO ontology.datasource_binding
  (version_id, object_type, kind, schema_name, table_name, pk_column, tenant_column) VALUES
  ('b0000000-0000-0000-0000-000000000001','Site',      'native','public','sites',              'id',     'tenant_id'),
  ('b0000000-0000-0000-0000-000000000001','LegalDD',   'native','public','legal_dd_checklist', 'site_id', NULL),
  ('b0000000-0000-0000-0000-000000000001','SiteBudget','native','public','site_budgets',       'id',     'tenant_id');


-- ═════════════════════════════════════════════════════════════════════════════
-- OVERLAY 1 — Tenant B (QSR). Requirement #4 (rename + add) and #3 (reorder).
-- ═════════════════════════════════════════════════════════════════════════════

-- rename the object type: Site -> Outlet
INSERT INTO ontology.object_type (version_id, api_name, display_name, plural, primary_key, implements) VALUES
  ('b0000000-0000-0000-0000-000000000002','Site','Outlet','Outlets','id','{Approvable,Documented}');

-- rename a property, and ADD one that exists in no base table
INSERT INTO ontology.property_def
  (version_id, object_type, api_name, display_name, type, required, storage, column_name, constraints) VALUES
  ('b0000000-0000-0000-0000-000000000002','Site','expectedRent','Base Rent','decimal', false,'column','expected_rent','{}'),
  -- storage='props_json': column_name names the JSON key inside sites.props
  ('b0000000-0000-0000-0000-000000000002','Site','franchiseRoyaltyPct','Franchise Royalty %','decimal', false,
   'props_json', 'franchise_royalty_pct', '{}');

-- REORDERED FLOW: design no longer waits on finance. Finance runs after design.
-- This is requirement #3, expressed entirely as a row.
INSERT INTO ontology.action_type
  (version_id, api_name, object_type, display_name, from_status, to_status,
   preconditions, required_role, required_module, side_effects) VALUES
  ('b0000000-0000-0000-0000-000000000002','design.open','Site','Open Design',
   '{approved,loi_uploaded}', NULL,
   '{"==":[{"var":"legal_dd_status"},"positive"]}'::jsonb,
   'business_admin','design',
   '[{"kind":"notify","template":"design_unlocked"}]'::jsonb);


-- ═════════════════════════════════════════════════════════════════════════════
-- OVERLAY 2 — Tenant C. Requirement #2: the base Site object type, backed by
-- the client's own ERP table, via column_map + value_map. No code change.
-- ═════════════════════════════════════════════════════════════════════════════
INSERT INTO ontology.datasource_binding
  (version_id, object_type, kind, schema_name, table_name, pk_column, tenant_column,
   column_map, value_map) VALUES
  ('b0000000-0000-0000-0000-000000000003','Site','native','client_erp','store_master','store_ref','org_id',
   '{"id":"store_ref",
     "code":"store_ref",
     "name":"store_name",
     "city":"town",
     "status":"lifecycle_state",
     "legalDdStatus":"legal_clearance",
     "financeStatus":"finance_clearance",
     "expectedRent":"monthly_rental",
     "areaSqft":"carpet_area"}'::jsonb,
   '{"status":{"LIVE":"approved","PIPELINE":"details_submitted"},
     "legalDdStatus":{"CLEARED":"positive","IN_REVIEW":"in_review","BLOCKED":"negative"},
     "financeStatus":{"RELEASED":"approved","PENDING_FIN":"pending"}}'::jsonb);
