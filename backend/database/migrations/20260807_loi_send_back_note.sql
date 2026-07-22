-- LOI send-back: a BD supervisor who receives the wrong LOI file can send it
-- back, returning the site from LOI_UPLOADED to APPROVED so the executive can
-- re-upload through the unchanged upload path.
--
-- The supervisor's comments are required, and the executive must see them on
-- the staging list. That page renders entirely off the /sites list payload and
-- never issues a per-site fetch, so an audit-only record would force a new
-- N-row lookup on a list screen. The note therefore lives on the row (the audit
-- event still carries it too, as the permanent record) — mirroring how the
-- design module stores supervisor_comments on the reviewed deliverable.
--
-- Additive: no rows are read, changed, or removed.
ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS loi_rejection_note TEXT;
