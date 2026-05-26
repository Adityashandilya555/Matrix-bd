-- 202605267 — add users.notes column for pending-signup state stash
--
-- The /auth/signup/supervisor and /auth/signup/executive flows stash the
-- requested module (and parent supervisor, for execs) in users.notes while the
-- row is is_active=false. business_admin_service and supervisor_code_service
-- parse this marker on the approval path.
--
-- Markers stored here:
--   pending_module:bd|legal|payment
--   pending_supervisor:<uuid>|module:bd|legal|payment

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS notes text NULL;
