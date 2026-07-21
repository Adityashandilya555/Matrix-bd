-- Allow project-excellence document uploads to be stored in site_files.
--
-- The new PE "Attachments" field (and the Financial Closure view that reuses
-- the same site-level document set) persists images with file_type='excellence'.
-- Extend the CHECK constraint to permit that value. Non-destructive: this only
-- drops and recreates a CHECK constraint — no rows are read, changed, or removed.

ALTER TABLE public.site_files DROP CONSTRAINT IF EXISTS chk_site_files_file_type;

ALTER TABLE public.site_files ADD CONSTRAINT chk_site_files_file_type
    CHECK (file_type IN ('loi', 'photo', 'quality_audit', 'excellence'));
