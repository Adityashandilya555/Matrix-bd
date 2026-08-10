-- ─────────────────────────────────────────────────────────────────────────────
-- Requirement #2: a client arrives with their OWN database and it must map onto
-- the predefined base ontology without a code change.
--
-- Nothing here resembles Matrix's schema. Different table name, different column
-- names, different primary key type (text, not uuid), and a different controlled
-- vocabulary ('CLEARED' where the base ontology says 'positive').
--
-- This is what a franchise partner's store master actually looks like.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS client_erp;

CREATE TABLE client_erp.store_master (
  store_ref         text PRIMARY KEY,
  org_id            uuid NOT NULL,
  store_name        text NOT NULL,
  town              text NOT NULL,
  lifecycle_state   text NOT NULL,
  legal_clearance   text NOT NULL,
  finance_clearance text NOT NULL,
  monthly_rental    numeric(12,2),
  carpet_area       integer
);

INSERT INTO public.tenants (id, name, code) VALUES
  ('33333333-3333-3333-3333-333333333333', 'Franchise Partner Ltd', 'FRANCH');

INSERT INTO client_erp.store_master
  (store_ref, org_id, store_name, town, lifecycle_state,
   legal_clearance, finance_clearance, monthly_rental, carpet_area)
VALUES
  ('STR-4471', '33333333-3333-3333-3333-333333333333',
   'Phoenix Marketcity', 'Pune',      'LIVE',    'CLEARED',  'RELEASED',   275000.00, 1300),
  ('STR-4472', '33333333-3333-3333-3333-333333333333',
   'Hinjewadi Phase 2',  'Pune',      'LIVE',    'CLEARED',  'PENDING_FIN',198000.00,  900),
  ('STR-4473', '33333333-3333-3333-3333-333333333333',
   'Baner Road',         'Pune',      'PIPELINE','IN_REVIEW','PENDING_FIN',225000.00, 1100);
