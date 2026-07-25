-- 20260809 — Configurable Rent Type: revenue-share split + staggered superset
-- (authored 2026-07-23; see Rent_Type_Integration_Plan.pdf §6.1)
--
-- ADDITIVE / NON-BREAKING. Nothing is dropped, renamed, or narrowed:
--   (a) Two nullable revenue-share columns on sites for the new Dine-in % /
--       Delivery % split — the one new UI element with no home in today's
--       schema (today only a single expected_revshare_pct exists).
--   (b) Widen is_valid_staggered_escalation() to a SUPERSET: it still requires
--       year+percent on every element, but now also ACCEPTS optional per-year
--       keys mg / dine_in_pct / delivery_pct, validating them only when present.
--       Legacy {year,percent} rows stay valid, so no backfill is needed.
--
-- FILENAME ORDERING (why 20260809, not the plan's suggested 20260724): the
-- startup runner applies migrations in sorted filename order on a fresh DB, and
-- 20260731_fix_staggered_escalation_json_null.sql does a CREATE OR REPLACE of
-- is_valid_staggered_escalation(). A 20260724 file would be OVERWRITTEN by
-- 20260731 during fresh provisioning and the superset would be silently lost.
-- Dating this AFTER 20260731 (and the current latest, 20260808) guarantees the
-- superset definition wins on fresh DBs, dev, and prod alike.
--
-- NOTE: the function must use double-dollar delimiters (not a named tag like
-- dollar-function-dollar) — the startup runner's SQL splitter
-- (main.py::_parse_sql_statements) only detects the double-dollar form for
-- dollar-quoting, and (deliberately) no double-dollar token appears anywhere in
-- these comments so the splitter's quote-state can never be toggled here.
-- BEGIN;/COMMIT; are stripped by that splitter (each statement runs in its own
-- transaction on a shared connection); they are kept for readability and parity
-- with sibling migrations.

BEGIN;

-- (a) Optional revenue-share split for the REV SHARE toggle. Nullable + no
--     default, so every existing row and every old client stays valid.
ALTER TABLE public.sites
    ADD COLUMN IF NOT EXISTS revshare_dinein_pct   numeric(6, 2),
    ADD COLUMN IF NOT EXISTS revshare_delivery_pct numeric(6, 2);

ALTER TABLE public.sites
    DROP CONSTRAINT IF EXISTS chk_revshare_dinein_range;
ALTER TABLE public.sites
    ADD CONSTRAINT chk_revshare_dinein_range
        CHECK (revshare_dinein_pct IS NULL OR (revshare_dinein_pct BETWEEN 0 AND 100));

ALTER TABLE public.sites
    DROP CONSTRAINT IF EXISTS chk_revshare_delivery_range;
ALTER TABLE public.sites
    ADD CONSTRAINT chk_revshare_delivery_range
        CHECK (revshare_delivery_pct IS NULL OR (revshare_delivery_pct BETWEEN 0 AND 100));

-- (b) Widen the staggered JSONB validator to a SUPERSET. Still requires
--     year+percent on every element; now also accepts optional per-year keys
--     mg / dine_in_pct / delivery_pct, validated ONLY when the key is present.
--     CREATE OR REPLACE => idempotent, and the existing chk_staggered_escalation
--     CHECK picks up the new logic automatically (signature is unchanged).
--     Keeps the 20260731 json-null hardening: SQL NULL and a JSON 'null' literal
--     both mean "no schedule".
CREATE OR REPLACE FUNCTION public.is_valid_staggered_escalation(arr jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    elem jsonb;
    y   int;
    p   float;
    mg  float;
    din float;
    del float;
BEGIN
    -- SQL NULL and a JSON 'null' literal both mean "no schedule".
    IF arr IS NULL OR jsonb_typeof(arr) = 'null' THEN
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
            -- Required on every element (unchanged contract).
            y := (elem->>'year')::int;
            p := (elem->>'percent')::float;
            IF y <= 0 OR p < 0 OR p > 100 THEN
                RETURN false;
            END IF;
            -- Optional per-year keys — validate ONLY when present.
            IF elem ? 'mg' THEN
                mg := (elem->>'mg')::float;
                IF mg < 0 THEN RETURN false; END IF;
            END IF;
            IF elem ? 'dine_in_pct' THEN
                din := (elem->>'dine_in_pct')::float;
                IF din < 0 OR din > 100 THEN RETURN false; END IF;
            END IF;
            IF elem ? 'delivery_pct' THEN
                del := (elem->>'delivery_pct')::float;
                IF del < 0 OR del > 100 THEN RETURN false; END IF;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RETURN false;
        END;
    END LOOP;
    RETURN true;
END;
$$;

COMMIT;
