-- 202606121 — Post-NSO launch "validation loop".
--
-- Reworks the launch approval chain from an approve-only ladder into the
-- admin → executive → supervisor → admin validation loop:
--
--   NSO final approval
--     → pending_admin_review     (admin reviews full details + all dept statuses;
--                                  edits ONLY rent terms; leaves a comment;
--                                  "Send for review")
--     → under_exec_review        (creating executive: read-only; Approve/Reject
--                                  + comment — verdict recorded, flows forward)
--     → under_supervisor_review  (supervisor: edits rent + Approve/Reject + comment)
--     → pending_admin_final      (admin sees every rent change draft→now + both
--                                  verdicts highlighted; can edit; "Confirm" =>
--                                  COMMIT staging into site_details + sites)
--     → ready_to_launch          (🚀 Launch button unlocks)
--     → launched
--
-- Until the final admin Confirm, ALL edits live only on launch_approvals (the
-- backend staging row) and launch_review_events — nothing touches the canonical
-- site_details / sites rent columns.
--
-- Three additive changes:
--   1. Re-point launch_approvals.status CHECK to the new FSM + migrate rows.
--   2. Add per-stage verdict / comment / actor / timestamp columns.
--   3. Create launch_review_events (the recorded comment + rent-edit timeline).
--
-- BACKWARD COMPATIBLE — every new column is nullable; legacy columns are kept.

BEGIN;

-- ── 1. New status FSM ─────────────────────────────────────────────────────────
-- Drop the old constraint, migrate existing rows to the nearest new state, then
-- re-add the constraint with the new value set.
-- NOTE: 202606094 created the CHECK inline, so Postgres auto-named it
-- `launch_approvals_status_check` (NOT the model's `chk_launch_approval_status`).
-- Drop BOTH names so this is correct whether the table came from the SQL
-- migration or from the ORM metadata.
ALTER TABLE public.launch_approvals
    DROP CONSTRAINT IF EXISTS chk_launch_approval_status;
ALTER TABLE public.launch_approvals
    DROP CONSTRAINT IF EXISTS launch_approvals_status_check;

UPDATE public.launch_approvals SET status = CASE status
    WHEN 'pending'              THEN 'pending_admin_review'
    WHEN 'admin_approved'       THEN 'under_exec_review'
    WHEN 'bd_confirmed'         THEN 'under_supervisor_review'
    WHEN 'supervisor_approved'  THEN 'pending_admin_final'
    WHEN 'super_admin_approved' THEN 'ready_to_launch'
    WHEN 'launched'             THEN 'launched'
    ELSE status
END
WHERE status IN (
    'pending','admin_approved','bd_confirmed',
    'supervisor_approved','super_admin_approved'
);

ALTER TABLE public.launch_approvals
    ALTER COLUMN status SET DEFAULT 'pending_admin_review';

ALTER TABLE public.launch_approvals
    ADD CONSTRAINT chk_launch_approval_status CHECK (status IN (
        'pending_admin_review',
        'under_exec_review',
        'under_supervisor_review',
        'pending_admin_final',
        'ready_to_launch',
        'launched'
    ));

-- ── 2. Per-stage verdict / comment / actor columns ────────────────────────────
-- Admin · first touch
ALTER TABLE public.launch_approvals
    ADD COLUMN IF NOT EXISTS admin_review_comment       text,
    ADD COLUMN IF NOT EXISTS admin_sent_for_review_at   timestamp with time zone,
    ADD COLUMN IF NOT EXISTS admin_sent_for_review_by   uuid REFERENCES public.users(id),
    -- Executive · review verdict (recorded, flows forward)
    ADD COLUMN IF NOT EXISTS exec_verdict               text,
    ADD COLUMN IF NOT EXISTS exec_comment               text,
    ADD COLUMN IF NOT EXISTS exec_reviewed_at           timestamp with time zone,
    ADD COLUMN IF NOT EXISTS exec_reviewed_by           uuid REFERENCES public.users(id),
    -- Supervisor · review verdict (+ may have edited rent)
    ADD COLUMN IF NOT EXISTS supervisor_verdict         text,
    ADD COLUMN IF NOT EXISTS supervisor_comment         text,
    ADD COLUMN IF NOT EXISTS supervisor_reviewed_at     timestamp with time zone,
    ADD COLUMN IF NOT EXISTS supervisor_reviewed_by     uuid REFERENCES public.users(id),
    -- Admin · final touch (DB commit happens here)
    ADD COLUMN IF NOT EXISTS admin_final_comment        text,
    ADD COLUMN IF NOT EXISTS admin_confirmed_at         timestamp with time zone,
    ADD COLUMN IF NOT EXISTS admin_confirmed_by         uuid REFERENCES public.users(id),
    ADD COLUMN IF NOT EXISTS committed_at               timestamp with time zone;

-- Verdicts are a small enum; guard them but allow NULL (not yet reviewed).
ALTER TABLE public.launch_approvals
    DROP CONSTRAINT IF EXISTS chk_launch_exec_verdict;
ALTER TABLE public.launch_approvals
    ADD CONSTRAINT chk_launch_exec_verdict
    CHECK (exec_verdict IS NULL OR exec_verdict IN ('approved','rejected'));

ALTER TABLE public.launch_approvals
    DROP CONSTRAINT IF EXISTS chk_launch_supervisor_verdict;
ALTER TABLE public.launch_approvals
    ADD CONSTRAINT chk_launch_supervisor_verdict
    CHECK (supervisor_verdict IS NULL OR supervisor_verdict IN ('approved','rejected'));

-- ── 3. launch_review_events — the recorded comment + rent-edit timeline ────────
-- One row per action in the loop: the draft baseline, each rent edit (with a
-- field-level diff), each verdict + comment, the final confirm, and the launch.
-- Powers the admin's "all rent changes from draft → end" view and the thread
-- that's visible to admin / executive / supervisor.
CREATE TABLE IF NOT EXISTS public.launch_review_events (
    id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    launch_approval_id uuid NOT NULL
                       REFERENCES public.launch_approvals(id) ON DELETE CASCADE,
    site_id            uuid NOT NULL
                       REFERENCES public.sites(id) ON DELETE CASCADE,
    tenant_id          uuid NOT NULL
                       REFERENCES public.tenants(id) ON DELETE CASCADE,

    actor_id           uuid REFERENCES public.users(id),
    actor_name         text,                 -- denormalised for the timeline render
    actor_role         text,                 -- business_admin | executive | supervisor | system

    stage              text NOT NULL,        -- admin_review | exec_review | supervisor_review | admin_final | system
    action             text NOT NULL,        -- baseline | edited | sent_for_review | approved | rejected | confirmed | committed | launched
    comment            text,
    changes            jsonb,                -- [{field,label,from,to}, …] for action='edited'/'baseline'

    created_at         timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_launch_review_events_approval
    ON public.launch_review_events(launch_approval_id, created_at);
CREATE INDEX IF NOT EXISTS idx_launch_review_events_site
    ON public.launch_review_events(site_id, created_at);

COMMIT;
