-- ─────────────────────────────────────────────────────────────────────────────
-- Faithful subset of the real Matrix schema.
--
-- backend/database/schema.sql carries an explicit warning that it is NOT meant
-- to be executed against a blank database (migrations are the deploy mechanism),
-- so this file reproduces only the tables the PoC needs.
--
-- sites, legal_dd_checklist and site_budgets are copied VERBATIM from
-- backend/database/schema.sql (lines 82-171, 519-545, 708-735) including their
-- CHECK constraints, because the whole point of the PoC is that the registry
-- describes the schema you actually have.
--
-- tenants and users are reduced to FK-satisfying stubs — the PoC never reads
-- anything from them beyond the id.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Verbatim from schema.sql:16 — sites has a CHECK that calls this.
CREATE OR REPLACE FUNCTION public.is_valid_staggered_escalation(arr jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    elem jsonb;
    y   int;
    p   float;
BEGIN
    IF arr IS NULL OR jsonb_typeof(arr) = 'null' THEN RETURN true; END IF;
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

-- ── stubs ────────────────────────────────────────────────────────────────────
CREATE TABLE public.tenants (
  id    uuid NOT NULL DEFAULT uuid_generate_v4(),
  name  text NOT NULL,
  code  text,
  CONSTRAINT tenants_pkey PRIMARY KEY (id)
);

CREATE TABLE public.users (
  id         uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id),
  name       text NOT NULL,
  role       text NOT NULL DEFAULT 'executive',
  CONSTRAINT users_pkey PRIMARY KEY (id)
);

-- ── sites (verbatim, schema.sql:82) ──────────────────────────────────────────
CREATE TABLE public.sites (
  id                       uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id                uuid NOT NULL,
  code                     text,
  status                   text NOT NULL DEFAULT 'draft_submitted'::text,
  name                     text NOT NULL,
  city                     text NOT NULL,
  address                  text,
  visit_date               date,
  notes                    text,
  model                    text,
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
  loi_rejection_note       text,
  archived_from_status     text,
  is_launched              boolean NOT NULL DEFAULT false,
  launched_at              timestamp with time zone,
  area_sqft                integer NOT NULL DEFAULT 0,
  staggered_escalation     jsonb,
  revshare_dinein_pct      numeric(6,2),
  revshare_delivery_pct    numeric(6,2),
  created_at               timestamp with time zone NOT NULL DEFAULT now(),
  updated_at               timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT sites_pkey PRIMARY KEY (id),
  CONSTRAINT sites_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT sites_submitted_by_fkey FOREIGN KEY (submitted_by) REFERENCES public.users(id),
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

-- ── legal_dd_checklist (verbatim, schema.sql:519) ────────────────────────────
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
  other_1_label    text,
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

-- ── site_budgets (verbatim, schema.sql:708) ──────────────────────────────────
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
  CONSTRAINT chk_site_budget_phase  CHECK (phase IN ('gfc','closure')),
  CONSTRAINT chk_site_budget_status CHECK (status IN ('draft','pending_supervisor','pending_admin','approved','rejected')),
  CONSTRAINT uq_site_budget_site_phase UNIQUE (site_id, phase)
);
