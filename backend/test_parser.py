raw_sql = """
BEGIN;

ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS area_sqft integer NOT NULL DEFAULT 0;

ALTER TABLE public.sites
    DROP CONSTRAINT IF EXISTS chk_area_sqft_positive;
ALTER TABLE public.sites
    ADD CONSTRAINT chk_area_sqft_positive CHECK (area_sqft >= 0);

ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS staggered_escalation jsonb;

CREATE OR REPLACE FUNCTION public.is_valid_staggered_escalation(arr jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    elem jsonb;
    y int;
    p float;
BEGIN
    IF arr IS NULL THEN
        RETURN true;
    END IF;
    IF jsonb_typeof(arr) != 'array' THEN
        RETURN false;
    END IF;
    IF jsonb_array_length(arr) > 5 THEN
        RETURN false;
    END IF;
    FOR elem IN SELECT * FROM jsonb_array_elements(arr)
    LOOP
        BEGIN
            y := (elem->>'year')::int;
            p := (elem->>'percent')::float;
            IF y <= 0 OR p < 0 OR p > 100 THEN
                RETURN false;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RETURN false;
        END;
    END LOOP;
    RETURN true;
END;
$$;

ALTER TABLE public.sites
    DROP CONSTRAINT IF EXISTS chk_staggered_escalation;
ALTER TABLE public.sites
    ADD CONSTRAINT chk_staggered_escalation CHECK (public.is_valid_staggered_escalation(staggered_escalation));

ALTER TABLE public.sites
    DROP CONSTRAINT IF EXISTS chk_sites_rent_type;
ALTER TABLE public.sites
    ADD CONSTRAINT chk_sites_rent_type
    CHECK (rent_type IN ('fixed', 'revshare', 'mg_revshare', 'staggered') OR rent_type IS NULL);

DO $$
BEGIN
    ALTER TABLE public.site_details DROP CONSTRAINT IF EXISTS chk_site_details_rent_type;
    ALTER TABLE public.site_details
        ADD CONSTRAINT chk_site_details_rent_type
        CHECK (rent_type IN ('fixed', 'revshare', 'mg_revshare', 'staggered') OR rent_type IS NULL);
EXCEPTION
    WHEN undefined_table THEN
        NULL;
END;
$$;

COMMIT;
"""

statements = []
current_stmt = []
in_dollar_quote = False

for line in raw_sql.splitlines():
    if "$$" in line:
        in_dollar_quote = (line.count("$$") % 2 == 1) ^ in_dollar_quote
        
    if not in_dollar_quote and line.strip().endswith(";"):
        current_stmt.append(line)
        stmt_text = "\n".join(current_stmt).strip()
        if stmt_text.upper() not in ("BEGIN;", "COMMIT;"):
            statements.append(stmt_text)
        current_stmt = []
    else:
        current_stmt.append(line)

for i, stmt in enumerate(statements):
    print(f"--- STATEMENT {i+1} ---")
    print(stmt)
