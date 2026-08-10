-- ─────────────────────────────────────────────────────────────────────────────
-- Two tenants with deliberately different vocabularies.
--   Tenant A — a coffee chain. Uses the base ontology unchanged ("Site").
--   Tenant B — a QSR chain. Overlays it ("Outlet", "Base Rent", + a royalty field).
--
-- Site A2 is the important row: legal DD is positive but finance is still
-- pending. Under today's hardcoded gate it is BLOCKED from design. Under a
-- reordered flow (design first, finance after) it is UNBLOCKED. Same row, same
-- code — only the JsonLogic changes.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.tenants (id, name, code) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Coffee Chain Co',  'COFFEE'),
  ('22222222-2222-2222-2222-222222222222', 'QSR Brands Ltd',   'QSR');

INSERT INTO public.users (id, tenant_id, name, role) VALUES
  ('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'Asha (BD)',   'executive'),
  ('a2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', 'Rahul (BD)',  'executive');

-- ── Tenant A sites ───────────────────────────────────────────────────────────
INSERT INTO public.sites
  (id, tenant_id, code, name, city, status, legal_dd_status, finance_status,
   expected_rent, area_sqft, submitted_by)
VALUES
  ('5171e001-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'BLR-001', 'Indiranagar 100ft Rd', 'Bengaluru', 'approved',
   'positive', 'approved', 285000.00, 1450, 'a1111111-1111-1111-1111-111111111111'),

  -- the pivotal row: legal cleared, finance NOT yet
  ('5171e002-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'BLR-002', 'Koramangala 5th Block', 'Bengaluru', 'approved',
   'positive', 'pending', 310000.00, 1600, 'a1111111-1111-1111-1111-111111111111'),

  ('5171e003-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'MUM-001', 'Bandra Linking Rd', 'Mumbai', 'details_submitted',
   'pending', 'pending', 450000.00, 1200, 'a1111111-1111-1111-1111-111111111111');

-- ── Tenant B sites — note props carries the overlay-only property ────────────
INSERT INTO public.sites
  (id, tenant_id, code, name, city, status, legal_dd_status, finance_status,
   expected_rent, area_sqft, submitted_by, props)
VALUES
  ('5171e004-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222',
   'DEL-001', 'Connaught Place Kiosk', 'New Delhi', 'approved',
   'positive', 'approved', 195000.00, 700, 'a2222222-2222-2222-2222-222222222222',
   '{"franchise_royalty_pct": 6.5}'::jsonb),

  ('5171e005-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222',
   'DEL-002', 'Saket Select City', 'New Delhi', 'approved',
   'positive', 'pending', 240000.00, 850, 'a2222222-2222-2222-2222-222222222222',
   '{"franchise_royalty_pct": 7.25}'::jsonb);

-- ── linked records, for the generic traversal proof ─────────────────────────
INSERT INTO public.legal_dd_checklist
  (site_id, title_doc, sanctioned_plan, oc_cc, commercial_use, final_verdict, stage)
VALUES
  ('5171e001-0000-0000-0000-000000000001', 'yes', 'yes', 'yes', 'yes', 'positive', 'published'),
  ('5171e002-0000-0000-0000-000000000002', 'yes', 'yes', 'na',  'yes', 'positive', 'published'),
  ('5171e003-0000-0000-0000-000000000003', 'pending','pending','pending','pending','pending','draft'),
  ('5171e004-0000-0000-0000-000000000004', 'yes', 'yes', 'yes', 'yes', 'positive', 'published'),
  ('5171e005-0000-0000-0000-000000000005', 'yes', 'na',  'yes', 'yes', 'positive', 'published');

INSERT INTO public.site_budgets
  (tenant_id, site_id, phase, status, budget_total, covers)
VALUES
  ('11111111-1111-1111-1111-111111111111', '5171e001-0000-0000-0000-000000000001', 'gfc', 'approved',  4850000.00, 48),
  ('11111111-1111-1111-1111-111111111111', '5171e002-0000-0000-0000-000000000002', 'gfc', 'draft',     5200000.00, 56),
  ('22222222-2222-2222-2222-222222222222', '5171e004-0000-0000-0000-000000000004', 'gfc', 'approved',  1950000.00, 18);
