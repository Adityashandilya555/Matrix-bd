-- Allow file_type='closure' on site_files: the Financial Closure phase gets its
-- own single budget attachment, distinct from Project Excellence's 'excellence'
-- doc (FC shows the PE doc read-only and uploads its own). Sibling of
-- 20260806_site_files_excellence_type.sql — same additive CHECK swap.
-- Added VALID (no NOT VALID), matching 20260806. This only WIDENS the allowed
-- set, so every existing row already satisfies it and the validating scan
-- cannot fail. NOT VALID would have left the constraint permanently
-- unvalidated and unusable by the query planner for no benefit.
ALTER TABLE public.site_files DROP CONSTRAINT IF EXISTS chk_site_files_file_type;
ALTER TABLE public.site_files ADD CONSTRAINT chk_site_files_file_type
    CHECK (file_type IN ('loi', 'photo', 'quality_audit', 'excellence', 'closure'));
