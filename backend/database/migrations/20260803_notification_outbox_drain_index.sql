-- 20260803 — Partial index for the email-drain query (#375)
-- (authored 2026-07-17, from the backend performance review)
--
-- notification_outbox was indexed on `status` alone, but drain_pending_emails
-- filters `channel = 'email' AND status = 'pending' AND attempts < 3` ordered by
-- created_at. A partial index scoped to the drain's hot set (email + pending)
-- and keyed on created_at serves the filter + ORDER BY directly, so the drain
-- doesn't scan/sort the whole outbox as email volume grows.
--
-- Plain (non-CONCURRENT) CREATE INDEX because the startup migration runner wraps
-- each statement in a transaction, and CREATE INDEX CONCURRENTLY cannot run
-- inside one. The outbox is small, so the brief lock is negligible.
-- Idempotent via IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS idx_notification_outbox_email_pending
    ON public.notification_outbox (created_at)
    WHERE channel = 'email' AND status = 'pending';
