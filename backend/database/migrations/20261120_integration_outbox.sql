-- NSO platform integration: outbox for signed webhooks (database side only).
--
-- Each business change on a site writes one integration_outbox row in the same
-- transaction as the change. A backend worker sends due rows, retries failures
-- and logs every HTTP attempt in integration_deliveries. integration_endpoints
-- is the per-workspace switch, target URL and encrypted signing secret.
--
-- Rules kept: idempotent (IF NOT EXISTS, constraints inline in CREATE TABLE),
-- no dollar-quoted blocks, updated_at set by the app. No seed rows: the
-- integration starts switched off for every workspace.
--
-- Security: RLS on with NO policies and anon/authenticated revoked, so the
-- Supabase REST API sees nothing. The backend connects as postgres (BYPASSRLS).
-- The REVOKE statements are last: they need Supabase's anon/authenticated roles.

-- ── integration_endpoints ────────────────────────────────────────────────────
-- No row, or enabled = false: nothing is queued or sent for that workspace.
-- secret_ciphertext is encrypted by the backend before it is stored, never plaintext.
CREATE TABLE IF NOT EXISTS public.integration_endpoints (
    id                          uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id                   uuid NOT NULL,
    integration                 text NOT NULL,
    enabled                     boolean NOT NULL DEFAULT false,
    endpoint_url                text NOT NULL,
    secret_ciphertext           text NOT NULL,
    secret_key_version          smallint NOT NULL DEFAULT 1,
    previous_secret_ciphertext  text,
    previous_secret_expires_at  timestamp with time zone,
    schema_version              text NOT NULL DEFAULT '1',
    created_by                  uuid,
    created_at                  timestamp with time zone NOT NULL DEFAULT now(),
    updated_at                  timestamp with time zone NOT NULL DEFAULT now(),
    disabled_at                 timestamp with time zone,
    CONSTRAINT integration_endpoints_pkey PRIMARY KEY (id),
    CONSTRAINT integration_endpoints_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
    CONSTRAINT integration_endpoints_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT uq_integration_endpoints_tenant_integration UNIQUE (tenant_id, integration),
    CONSTRAINT chk_integration_endpoints_integration CHECK (integration IN ('nso_platform')),
    CONSTRAINT chk_integration_endpoints_https CHECK (endpoint_url ~ '^https://[^/?#[:space:]]+'),
    CONSTRAINT chk_integration_endpoints_previous_secret CHECK (
        (previous_secret_ciphertext IS NULL) = (previous_secret_expires_at IS NULL)
    )
);

-- ── integration_outbox ───────────────────────────────────────────────────────
-- id is also the webhook event id (NSO drops duplicates by it). seq only grows:
-- NSO keeps the highest seq per site and ignores older ones. payload is a full
-- site snapshot. site_id has NO foreign key on purpose, so a "site.deleted"
-- event survives the hard delete of its site.
-- Status lifecycle (enforced by the app): pending -> sending -> sent, or
-- sending -> failed -> sending ... -> dead (kept for manual replay). A sending
-- row whose locked_at is older than 5 minutes may be claimed again.
CREATE TABLE IF NOT EXISTS public.integration_outbox (
    id                uuid NOT NULL DEFAULT gen_random_uuid(),
    seq               bigint GENERATED ALWAYS AS IDENTITY,
    tenant_id         uuid NOT NULL,
    integration       text NOT NULL,
    site_id           uuid NOT NULL,
    event_type        text NOT NULL,
    schema_version    text NOT NULL,
    payload           jsonb NOT NULL,
    status            text NOT NULL DEFAULT 'pending',
    attempts          integer NOT NULL DEFAULT 0,
    next_attempt_at   timestamp with time zone NOT NULL DEFAULT now(),
    locked_at         timestamp with time zone,
    locked_by         text,
    last_http_status  integer,
    last_error        text,
    sent_at           timestamp with time zone,
    created_at        timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT integration_outbox_pkey PRIMARY KEY (id),
    CONSTRAINT integration_outbox_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
    CONSTRAINT chk_integration_outbox_integration CHECK (integration IN ('nso_platform')),
    CONSTRAINT chk_integration_outbox_event_type CHECK (event_type ~ '^site\.[a-z_]+$'),
    CONSTRAINT chk_integration_outbox_status CHECK (status IN ('pending','sending','sent','failed','dead')),
    CONSTRAINT chk_integration_outbox_attempts CHECK (attempts >= 0)
);

-- The worker's "what is due now" claim (FOR UPDATE SKIP LOCKED).
CREATE INDEX IF NOT EXISTS idx_integration_outbox_due
    ON public.integration_outbox (next_attempt_at)
    WHERE status IN ('pending','failed');

-- Claims left behind by a dead worker.
CREATE INDEX IF NOT EXISTS idx_integration_outbox_stale
    ON public.integration_outbox (locked_at)
    WHERE status = 'sending';

-- Latest event per site, and the per-site history.
CREATE INDEX IF NOT EXISTS idx_integration_outbox_site
    ON public.integration_outbox (tenant_id, integration, site_id, seq);

-- The dead-letter list for replay.
CREATE INDEX IF NOT EXISTS idx_integration_outbox_dead
    ON public.integration_outbox (tenant_id, created_at)
    WHERE status = 'dead';

-- Retention: the cleanup deletes sent rows older than 30 days.
CREATE INDEX IF NOT EXISTS idx_integration_outbox_sent
    ON public.integration_outbox (sent_at)
    WHERE status = 'sent';

-- ── integration_deliveries ───────────────────────────────────────────────────
-- One row per HTTP attempt. http_status is null when no response came back.
CREATE TABLE IF NOT EXISTS public.integration_deliveries (
    id                uuid NOT NULL DEFAULT gen_random_uuid(),
    outbox_id         uuid NOT NULL,
    tenant_id         uuid NOT NULL,
    attempt_no        integer NOT NULL,
    http_status       integer,
    duration_ms       integer,
    error             text,
    response_snippet  text,
    attempted_at      timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT integration_deliveries_pkey PRIMARY KEY (id),
    CONSTRAINT integration_deliveries_outbox_id_fkey FOREIGN KEY (outbox_id) REFERENCES public.integration_outbox(id) ON DELETE CASCADE,
    CONSTRAINT integration_deliveries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE,
    CONSTRAINT chk_integration_deliveries_attempt_no CHECK (attempt_no >= 1)
);

-- One unique index is both the lookup index and the (outbox_id, attempt_no) uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_deliveries_outbox
    ON public.integration_deliveries (outbox_id, attempt_no);

-- ── Block the Supabase public API ────────────────────────────────────────────
ALTER TABLE public.integration_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.integration_endpoints FROM anon, authenticated;
REVOKE ALL ON public.integration_outbox FROM anon, authenticated;
REVOKE ALL ON public.integration_deliveries FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.integration_outbox_seq_seq FROM anon, authenticated;
