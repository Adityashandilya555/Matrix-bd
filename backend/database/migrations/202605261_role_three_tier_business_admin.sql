-- Role: collapse to three-tier hierarchy (business_admin, supervisor, executive).
--
-- Why this migration:
--   Previous role vocabulary {executive, sub_supervisor, supervisor} is
--   superseded by a cleaner three-tier hierarchy:
--     platform_admin → business_admin → supervisor (per module) → executive
--   sub_supervisor collapses into executive (lowest tier). business_admin is
--   modelled as a separate promotion table (see 202605262) so an account's
--   base role stays in {supervisor, executive} and the admin grant is layered
--   on top.
--
-- Order is important: the data rewrite must run BEFORE the new CHECK lands,
-- otherwise the constraint will reject the row mid-update.

UPDATE public.users SET role = 'executive' WHERE role = 'sub_supervisor';

ALTER TABLE public.users
    DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('business_admin', 'supervisor', 'executive'));
