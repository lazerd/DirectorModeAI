-- =====================================================================
-- Who strung the racket, and who has been paid.
--
--   stringer_name     free text — a stringer doesn't need an account; the
--                     UI suggests names this owner has used before.
--   stringer_paid_at  set when the stringer has been paid for this job.
--   customer_paid_at  set when the customer has paid for the restring.
--
-- Timestamps rather than booleans so "when" is kept for free; the UI shows
-- them as checkboxes. Row access is unchanged — the existing "owner manages
-- stringing jobs" policy covers the new columns.
--
-- Run: node scripts/dbrun.mjs supabase/migrations/stringing_job_payments.sql
-- Safe to re-run.
-- =====================================================================

ALTER TABLE stringing_jobs
  ADD COLUMN IF NOT EXISTS stringer_name    TEXT,
  ADD COLUMN IF NOT EXISTS stringer_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_paid_at TIMESTAMPTZ;
