-- Phase D: the project NSO-Handover push opens the NSO record directly at stage
-- three. handover_pushed_at marks that a site was handed over from the Project
-- module (after the admin-confirmed quality audit). nso_service._compute_stage
-- uses it to surface stage three (stages 1 & 2 are already satisfied upstream:
-- CA/token approval = stage 1, project-initiation approval = stage 2). Additive.
ALTER TABLE public.nso_reviews
    ADD COLUMN IF NOT EXISTS handover_pushed_at TIMESTAMPTZ;
