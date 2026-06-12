-- #85: bind password-reset completion to a single-use token issued at admin
-- approval. Only the sha256 hash is stored; plaintext is shown once to the
-- approving platform admin (relayed out-of-band, like workspace codes).
-- Applied to live Supabase via MCP on 2026-06-12 (migration: reset_token_binding).
ALTER TABLE public.password_reset_requests
  ADD COLUMN IF NOT EXISTS reset_token_hash text,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;
