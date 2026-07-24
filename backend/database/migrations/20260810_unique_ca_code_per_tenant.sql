-- 20260810 — One CA / Commercial Code per site, per workspace.
--
-- sites.ca_code shipped as a plain nullable text column with no constraint, and
-- neither writer (svc_save_finance_draft / svc_finance_request_approval) checked
-- whether the code was already taken. Two sites could therefore hold the same
-- code — and because `site.ca_code or site.code` is the display identifier once
-- finance is filled in (~15 services and every downstream queue row use it), the
-- duplicates became indistinguishable in Legal, Design, Project, NSO and Launch.
--
-- Scope is the tenant, not the whole table: every query in this codebase is
-- tenant-scoped, and one workspace's accounting codes are none of another
-- workspace's business.
--
-- The index is functional on upper(ca_code) so a legacy mixed-case row still
-- collides with its uppercase twin. The service normalises to upper() on write.
--
-- Runner notes: each statement runs in its own transaction; the runner strips
-- bare BEGIN;/COMMIT; and only recognises `$$` for dollar-quote detection, so
-- the DO block below uses `$$`.

-- 1. Refuse to build the index over existing duplicates. A failing statement is
--    logged and leaves this file unrecorded in schema_migrations (it retries on
--    the next deploy) WITHOUT aborting startup — so a dirty database costs a
--    loud log line, not an outage. Clear the losing site's ca_code (or delete
--    the duplicate site) and redeploy.
DO $$
DECLARE
    dupes text;
BEGIN
    SELECT string_agg(
               format('tenant=%s code=%s sites=%s', tenant_id, code, site_ids),
               '; '
           )
      INTO dupes
      FROM (
          SELECT tenant_id,
                 upper(ca_code)   AS code,
                 array_agg(id)    AS site_ids
            FROM public.sites
           WHERE ca_code IS NOT NULL AND ca_code <> ''
           GROUP BY tenant_id, upper(ca_code)
          HAVING count(*) > 1
      ) d;

    IF dupes IS NOT NULL THEN
        RAISE EXCEPTION
            'Cannot enforce unique CA codes: duplicates already exist -> %. '
            'Clear ca_code on the losing site(s) or delete the duplicate site, then redeploy.',
            dupes;
    END IF;
END
$$;

-- 2. The constraint itself. Partial so the many sites with no CA code yet (and
--    any '' written by an older client) don't collide with each other.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sites_tenant_ca_code
    ON public.sites (tenant_id, upper(ca_code))
    WHERE ca_code IS NOT NULL AND ca_code <> '';
