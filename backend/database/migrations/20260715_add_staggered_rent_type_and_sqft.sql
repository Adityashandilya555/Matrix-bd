-- Add area_sqft column (if not already present) and allow NULL for backward compatibility
ALTER TABLE sites
    ADD COLUMN IF NOT EXISTS area_sqft INTEGER NOT NULL DEFAULT 0;

-- Add staggered_escalation column (JSONB) for future use
ALTER TABLE sites
    ADD COLUMN IF NOT EXISTS staggered_escalation JSONB;

-- Update rent_type constraint to include 'staggered'
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_sites_rent_type') THEN
        ALTER TABLE sites DROP CONSTRAINT chk_sites_rent_type;
    END IF;
END $$;

ALTER TABLE sites
    ADD CONSTRAINT chk_sites_rent_type
    CHECK (rent_type IN ('fixed','revshare','mg_revshare','staggered') OR rent_type IS NULL);
