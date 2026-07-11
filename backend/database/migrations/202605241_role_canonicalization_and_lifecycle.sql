-- Role canonicalization + pipeline lifecycle scaffolding.
--
-- Why this migration:
--   1. The role string 'bd_person' was the original placeholder. The backend
--      permission system only recognises {executive, sub_supervisor,
--      supervisor}; every require_role() guard silently 403s for bd_person
--      users. Collapsing to the canonical vocabulary and enforcing it with a
--      CHECK constraint kills the whole bug class.
--   2. The shortlist form (frontend/src/modules/loi/details/AddDetailsPage.jsx)
--      only captures a subset of the original site_details columns. The
--      unused ones produce schema-drift confusion and tempt us to "wire them
--      up later"; better to drop them and re-add deliberately if a field is
--      ever actually requested. site_details currently has 0 rows so this
--      drop is data-safe.
--   3. Supervisor can archive a site for future reference. Revive must
--      restore it to whichever status it held before archive. We record that
--      status in sites.archived_from_status at archive time.
--   4. Shortlist approval is supervisor-only by default; the supervisor can
--      opt-in delegate that power on a specific site to a specific
--      sub_supervisor. shortlist_delegations is the per-site grant table.
--   5. password_hash on users: originally removed here (May 2026) when auth
--      was passwordless. Re-introduced in migration 202606081 (Jun 2026) for
--      branded per-user passwords. The DROP below has been removed so that
--      202606081 owns the column lifecycle and passwords are not wiped on restart.


-- ── 1. Role canonicalization ───────────────────────────────────────────────
-- Live data before migration:
--   supervisor      5
--   bd_person       4
--   executive       1
--   sub_supervisor  1
-- After UPDATE: 5 supervisor, 5 executive, 1 sub_supervisor.

UPDATE public.users SET role = 'executive' WHERE role = 'bd_person';

ALTER TABLE public.users
    ALTER COLUMN role SET DEFAULT 'executive';

ALTER TABLE public.users
    DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('executive', 'sub_supervisor', 'supervisor'));


-- ── 2. password_hash column — INTENTIONALLY NOT DROPPED HERE ─────────────
-- This statement originally dropped password_hash when auth was passwordless.
-- Migration 202606081 re-introduced the column for branded login (Jun 2026).
-- Removing the DROP prevents all user passwords from being wiped on every
-- server restart (202605241 sorts before 202606081, so DROP ran first).


-- ── 3. Trim site_details to the fields the UI actually captures ────────────
-- Form captures: model, spocName, googlePin, score, estSales, nearestStarbucks,
-- nearestTWC, carpet, cam, rentType, rent, capex, deposit, brokerage,
-- escalation, rentFreeDays, lockin, tenure. The columns dropped below have
-- no UI surface to set them; site_details has 0 rows so this is data-safe.
--
-- completion_pct (generated) depends only on: carpet_area_sqft,
-- estimated_monthly_sales, capex, security_deposit, score, rent_type,
-- fixed_rent_amt, nearest_starbucks_m, lock_in_months, tenure_months —
-- none of which are dropped here. Generated column remains valid.

ALTER TABLE public.site_details DROP COLUMN IF EXISTS floor_number;
ALTER TABLE public.site_details DROP COLUMN IF EXISTS total_area_sqft;
ALTER TABLE public.site_details DROP COLUMN IF EXISTS nearest_competitor_m;
ALTER TABLE public.site_details DROP COLUMN IF EXISTS nearest_competitor_name;
ALTER TABLE public.site_details DROP COLUMN IF EXISTS has_parking;
ALTER TABLE public.site_details DROP COLUMN IF EXISTS has_outdoor_seating;
ALTER TABLE public.site_details DROP COLUMN IF EXISTS is_corner_property;
ALTER TABLE public.site_details DROP COLUMN IF EXISTS score_notes;


-- ── 4. Revive support: remember pre-archive status ─────────────────────────
ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS archived_from_status text;


-- ── 5. Shortlist approval delegation ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shortlist_delegations (
    id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    site_id           uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    delegate_user_id  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    granted_by        uuid NOT NULL REFERENCES public.users(id),
    granted_at        timestamp with time zone NOT NULL DEFAULT now(),
    revoked_at        timestamp with time zone,
    revoked_by        uuid REFERENCES public.users(id),
    notes             text
);

-- One active grant per (site, delegate); a new grant is allowed after revoke.
CREATE UNIQUE INDEX IF NOT EXISTS shortlist_delegations_active_uidx
    ON public.shortlist_delegations (site_id, delegate_user_id)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS shortlist_delegations_tenant_site_idx
    ON public.shortlist_delegations (tenant_id, site_id);

CREATE INDEX IF NOT EXISTS shortlist_delegations_delegate_active_idx
    ON public.shortlist_delegations (delegate_user_id)
    WHERE revoked_at IS NULL;

ALTER TABLE public.shortlist_delegations ENABLE ROW LEVEL SECURITY;

-- Matches the tenant_isolation pattern used by the newer policies on
-- sites / approvals / audit_logs / notification_outbox / stage_events.
CREATE POLICY tenant_isolation_shortlist_delegations
    ON public.shortlist_delegations
    USING (tenant_id = get_current_tenant_id());
