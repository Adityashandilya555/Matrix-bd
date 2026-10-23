-- 20261023 — Executive grants into NSO, as NSO supervisor access.
--
-- 20261022 excluded NSO from executive_module_access_grants because NSO is a
-- supervisor-only module with no executive role to borrow. An NSO grant is
-- therefore a different thing: approving it lets the executive act as an NSO
-- SUPERVISOR, and only on NSO's own routes (/api/nso/*). app/core/deps.py
-- applies that role per request and nowhere else — every other route still
-- sees an executive, because the BD routes carry no module guard and a
-- module-wide supervisor role would reach them.
--
-- An NSO row names no target supervisor: a supervisor does not report to one.
-- target_supervisor_id stays NULL for it, and the "chosen supervisor must be an
-- active supervisor" rules in deps.py, list_my_team and the orphan sweep skip
-- module = 'nso'. No CHECK ties the two together, because the column is ON
-- DELETE SET NULL and such a CHECK would make deleting any chosen supervisor of
-- a non-NSO row fail.
--
-- Runner notes: one statement per transaction; `$$` never appears here.

ALTER TABLE public.executive_module_access_grants
    DROP CONSTRAINT IF EXISTS chk_emag_module;

ALTER TABLE public.executive_module_access_grants
    ADD CONSTRAINT chk_emag_module CHECK (
        module IN ('bd', 'legal', 'design', 'project', 'project_excellence', 'nso')
    );
