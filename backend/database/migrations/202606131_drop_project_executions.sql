-- Migration: Drop the abandoned project_executions table (issue #118)
--
-- project_executions was a generation-1 design (created in 202606033) that was
-- superseded by project_reviews before any data was ever written (0 rows).
-- It carries 7 dangling FK columns, has no ORM model, and is referenced nowhere
-- in backend/app — verified by grep.  Keeping it risks mis-wiring future code.
--
-- Safe to DROP:
--   • 0 rows in live DB
--   • No FK that points *to* this table from any other table
--   • No ORM model (models.py has no ProjectExecution class)
--   • No backend service / router reference

DROP TABLE IF EXISTS public.project_executions;
