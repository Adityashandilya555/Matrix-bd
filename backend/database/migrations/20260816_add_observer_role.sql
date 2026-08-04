-- 20260816 — Add the workspace-wide read-only `observer` role.
--
-- An observer sees everything in the workspace and modifies nothing. The rule is
-- enforced in the application, not here: app/rbac/guards.py grants it every route
-- guard, and app/core/deps.py refuses every non-GET request it makes.
--
-- ONLY users.role is widened. The two other role CHECKs are deliberately left
-- narrow, because leaving them narrow asserts something true about this role:
--
--   user_module_memberships.role_in_module — an observer is workspace-wide and
--     must never hold a module membership row. If an approval path ever tries to
--     write one, this constraint is what stops it.
--   stage_events.actor_role — an observer never acts, so it can never appear as
--     the actor on a stage transition.
--
-- The existing CHECK is declared INLINE on the column, so its name is whatever
-- Postgres auto-generated (users_role_check, or users_role_check1… if the column
-- ever carried more than one). Dropping a guessed name would silently no-op with
-- IF EXISTS and leave the old constraint in force, so discover it instead.
--
-- Idempotent: the DO block also matches the constraint this migration adds, so a
-- re-run drops and re-adds it. The runner ledgers by filename + checksum and runs
-- each statement in its own transaction; a failure leaves the file unrecorded and
-- retries on the next boot.

DO $$
DECLARE
    con_name text;
    dropped  int := 0;
BEGIN
    FOR con_name IN
        SELECT con.conname
          FROM pg_constraint con
          JOIN pg_class     rel ON rel.oid = con.conrelid
          JOIN pg_namespace ns  ON ns.oid  = rel.relnamespace
         WHERE ns.nspname  = 'public'
           AND rel.relname = 'users'
           AND con.contype = 'c'
           AND pg_get_constraintdef(con.oid) ILIKE '%role%business_admin%'
    LOOP
        EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', con_name);
        dropped := dropped + 1;
    END LOOP;

    -- Nothing to drop on a database provisioned after this migration; that is
    -- fine. Log it so a genuinely unexpected schema shape is visible in the
    -- deploy output rather than silent.
    IF dropped = 0 THEN
        RAISE NOTICE 'users: no pre-existing role CHECK matched; adding the new one.';
    END IF;
END $$;

ALTER TABLE public.users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('business_admin', 'observer', 'supervisor', 'executive'));
