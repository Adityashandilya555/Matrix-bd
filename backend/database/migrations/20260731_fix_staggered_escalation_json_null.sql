-- 20260731 — Harden is_valid_staggered_escalation() against a JSON 'null' value
-- (authored 2026-07-13)
--
-- ROOT CAUSE of "Database schema mismatch or constraint violation during site
-- creation" for EVERY rent type except 'staggered' (both dev and prod, since the
-- staggered_escalation column + chk_staggered_escalation constraint were added):
--
--   For a non-staggered draft the ORM writes staggered_escalation = None. SQLAlchemy's
--   JSONB type defaults to none_as_null=False, so it binds Python None as the JSON
--   value 'null' ('null'::jsonb) — NOT SQL NULL. The CHECK constraint then evaluates
--   is_valid_staggered_escalation('null'::jsonb):
--       'null'::jsonb IS NULL            -> false   (json-null is not sql-null)
--       jsonb_typeof('null'::jsonb)      -> 'null'  (!= 'array')  -> RETURN false
--   so the CHECK fails and the INSERT is rejected. A 'staggered' draft sends a real
--   JSON array, which passes — which is why only staggered worked.
--
-- The app-side fix is JSONB(none_as_null=True) on the model (writes SQL NULL). This
-- migration is the matching DB-side hardening: treat a JSON 'null' schedule exactly
-- like a missing schedule so the constraint can never reject "no staggered schedule"
-- again, regardless of how a client binds None. Idempotent (CREATE OR REPLACE).
--
-- NOTE: $$ (not $function$) delimiters are required — the startup migration runner's
-- SQL splitter only recognises $$ for dollar-quote detection.

CREATE OR REPLACE FUNCTION public.is_valid_staggered_escalation(arr jsonb)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    elem jsonb;
    y int;
    p float;
BEGIN
    -- Treat SQL NULL and a JSON 'null' literal identically: both mean "no schedule".
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
