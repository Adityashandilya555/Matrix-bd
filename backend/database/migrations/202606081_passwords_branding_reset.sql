-- 202606081 — Branded login: per-user passwords, per-tenant branding,
--             and a platform-admin password-reset queue.
--
-- ADDITIVE & BACKWARD-COMPATIBLE. Existing users keep `password_hash = NULL`
-- and continue to log in passwordlessly via the current UI until they set a
-- password through the new branded login page — so this migration does not
-- break any live session or the demo.
--
-- Apply BEFORE deploying the Phase-1 backend code (the new /auth endpoints
-- read these columns/table).

BEGIN;

-- 1. Per-user password hash (bcrypt). NULL = no password set yet (legacy).
ALTER TABLE users   ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- 2. Per-tenant logo for the customized login page. `tenants.name` already
--    holds the company display name; we only add the logo here.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS logo_url      TEXT;

-- 3. Password-reset requests, routed to the PLATFORM admin (not the business
--    admin). Lifecycle: pending -> approved -> completed (or rejected).
CREATE TABLE IF NOT EXISTS password_reset_requests (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id      UUID          REFERENCES users(id)   ON DELETE CASCADE,
    email        TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at  TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    CONSTRAINT password_reset_status_chk
        CHECK (status IN ('pending', 'approved', 'completed', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_pwd_reset_status
    ON password_reset_requests (status);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_tenant_email
    ON password_reset_requests (tenant_id, lower(email));

-- RLS on, no policies — matches the other backend-only tables (business_admins,
-- module_codes, site_delegations, workspace_requests, …). The table is then
-- reachable only via the backend's privileged role (which bypasses RLS), never
-- the anon / PostgREST API. It holds emails + reset state, so this matters.
ALTER TABLE password_reset_requests ENABLE ROW LEVEL SECURITY;

COMMIT;
