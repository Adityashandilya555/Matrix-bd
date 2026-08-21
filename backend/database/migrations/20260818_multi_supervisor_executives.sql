-- 20260818 — let an executive report to several supervisors within one module.
--
-- Until now user_module_memberships carried UNIQUE (user_id, module) and a single
-- nullable supervisor_id, so one row per (user, module) meant one supervisor,
-- structurally. If BD had two supervisors an executive could be on one team or
-- the other, never both.
--
-- Replaced by two PARTIAL unique indexes, which split the two shapes the table
-- actually holds:
--
--   supervisor_id IS NULL     supervisors, and executives whose supervisor is
--                             gone. Still exactly one row per (user, module).
--   supervisor_id IS NOT NULL executives. One row per supervisor, which is the
--                             whole point of this migration.
--
-- Note on the FK: user_module_memberships.supervisor_id is ON DELETE SET NULL,
-- so deleting a supervisor who shares an executive could in principle produce a
-- second NULL row and violate the first index. Unreachable today — nothing
-- deletes an ACTIVE supervisor (deactivate_org_user sets is_active = false, and
-- every DELETE FROM users is guarded to inactive users or to observers, who hold
-- no membership row at all).
--
-- MUST deploy together with the application change that rewrites the three
-- `ON CONFLICT (user_id, module)` inserts. That clause infers this exact index;
-- the moment it is gone the inserts fail with "no unique or exclusion constraint
-- matching the ON CONFLICT specification".

ALTER TABLE public.user_module_memberships
  DROP CONSTRAINT IF EXISTS user_module_memberships_user_module_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_umm_user_module_unsupervised
  ON public.user_module_memberships (user_id, module)
  WHERE supervisor_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_umm_user_module_supervisor
  ON public.user_module_memberships (user_id, module, supervisor_id)
  WHERE supervisor_id IS NOT NULL;
