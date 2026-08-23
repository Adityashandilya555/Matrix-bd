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
-- WHY THE OLD CONSTRAINT IS DROPPED BY DISCOVERY, NOT BY NAME
--
-- schema.sql spells it `CONSTRAINT user_module_memberships_user_module_key`, and
-- dropping that name looks obviously correct. It is not: schema.sql is a
-- historical snapshot that is never executed (docs/10-change-management/
-- change-rules.md), and the migration that actually created this table —
-- 202605265_user_module_memberships_table.sql — declares the constraint
-- ANONYMOUSLY, so Postgres generated its own name. A guessed name silently
-- matches nothing under IF EXISTS: the old constraint survives, the two indexes
-- below are created as redundant weaker ones, the migration records itself
-- applied, and every second-supervisor INSERT then fails with a unique violation
-- the ON CONFLICT arbiter does not cover. A dead feature and a green deploy.
--
-- So: find whatever unique thing covers exactly (user_id, module), drop it, and
-- then REFUSE to finish if one is still there. A migration that cannot do its job
-- must fail loudly rather than report success.
--
-- TWO THINGS IN THE LOOKUPS THAT LOOK WRONG AND ARE NOT
--
--   `attnum = ANY (i.indkey)`, not `unnest(i.indkey::int[])`. indkey is
--   int2vector, and pg_cast has int2vector -> int2[] but nothing to integer[],
--   so the cast form parses cleanly and fails at execution — which here means
--   the DO block raises on deploy.
--
--   `indnatts = 2` / `array_length(conkey, 1) = 2`. ANY is membership, not
--   equality: without the column count a three-column index whose first two
--   happen to be (user_id, module) would match and be dropped.
--
-- Neither is covered by a test. Nothing in the suite executes SQL, so anything
-- asserted about this file could only restate it as Python substrings — which a
-- correct rewrite fails and a broken one that keeps the strings passes. This
-- comment is the durable form; proving it needs real Postgres.
--
-- Note on the FK: supervisor_id is ON DELETE SET NULL, so deleting a supervisor
-- who shares an executive could in principle produce a second NULL row and
-- violate the first index. Unreachable today — nothing deletes an ACTIVE
-- supervisor (deactivate_org_user sets is_active = false, and every
-- DELETE FROM users is guarded to inactive users or to observers, who hold no
-- membership row at all).
--
-- MUST deploy together with the application change that rewrites the three
-- `ON CONFLICT (user_id, module)` inserts — that clause infers the index this
-- migration removes.

DO $$
DECLARE
    obj  record;
    left_over int;
BEGIN
    -- Unique CONSTRAINTS whose key is exactly (user_id, module), whatever they
    -- are called.
    FOR obj IN
        SELECT con.conname
          FROM pg_constraint con
          JOIN pg_class     rel ON rel.oid = con.conrelid
          JOIN pg_namespace ns  ON ns.oid  = rel.relnamespace
         WHERE ns.nspname  = 'public'
           AND rel.relname = 'user_module_memberships'
           AND con.contype = 'u'
           AND array_length(con.conkey, 1) = 2
           AND (SELECT array_agg(att.attname::text ORDER BY att.attname)
                  FROM pg_attribute att
                 WHERE att.attrelid = con.conrelid
                   AND att.attnum = ANY (con.conkey))
               = ARRAY['module', 'user_id']
    LOOP
        RAISE NOTICE 'dropping unique constraint %', obj.conname;
        EXECUTE format('ALTER TABLE public.user_module_memberships DROP CONSTRAINT %I', obj.conname);
    END LOOP;

    -- And any bare unique INDEX with the same key that is not backing a
    -- constraint (and is not one of the two partial ones added below).
    FOR obj IN
        SELECT idx.relname
          FROM pg_index i
          JOIN pg_class idx ON idx.oid = i.indexrelid
          JOIN pg_class rel ON rel.oid = i.indrelid
          JOIN pg_namespace ns ON ns.oid = rel.relnamespace
         WHERE ns.nspname  = 'public'
           AND rel.relname = 'user_module_memberships'
           AND i.indisunique
           AND i.indpred IS NULL
           AND i.indnatts = 2
           AND (SELECT array_agg(att.attname::text ORDER BY att.attname)
                  FROM pg_attribute att
                 WHERE att.attrelid = i.indrelid
                   AND att.attnum = ANY (i.indkey))
               = ARRAY['module', 'user_id']
    LOOP
        RAISE NOTICE 'dropping unique index %', obj.relname;
        EXECUTE format('DROP INDEX public.%I', obj.relname);
    END LOOP;

    -- The guard. If anything still enforces one row per (user, module), the
    -- feature cannot work and the deploy must not pretend otherwise.
    SELECT count(*) INTO left_over
      FROM pg_index i
      JOIN pg_class rel ON rel.oid = i.indrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
     WHERE ns.nspname  = 'public'
       AND rel.relname = 'user_module_memberships'
       AND i.indisunique
       AND i.indpred IS NULL
       AND i.indnatts = 2
       AND (SELECT array_agg(att.attname::text ORDER BY att.attname)
              FROM pg_attribute att
             WHERE att.attrelid = i.indrelid
               AND att.attnum = ANY (i.indkey))
           = ARRAY['module', 'user_id'];

    IF left_over > 0 THEN
        RAISE EXCEPTION
            'user_module_memberships still has a total UNIQUE on (user_id, module); '
            'an executive cannot report to two supervisors until it is gone';
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_umm_user_module_unsupervised
  ON public.user_module_memberships (user_id, module)
  WHERE supervisor_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_umm_user_module_supervisor
  ON public.user_module_memberships (user_id, module, supervisor_id)
  WHERE supervisor_id IS NOT NULL;
