-- ============================================
-- SwimMode — per-job auto-award-on-signup toggle
-- ============================================
-- swim_jobs.auto_award_on_signup
--   FALSE (default) — current behavior: family signs up → status='signed_up'
--     (gray on thermometer); lead must mark complete in Tracker for points to
--     count.
--   TRUE  — family signing up creates status='completed' immediately so points
--     count right away (color on thermometer). Lead doesn't need to do anything.
--
-- swim_assignments.auto_awarded
--   Marks an assignment as having been awarded automatically by the public
--   signup flow (vs. manually by the lead). Used to permit family-side cancel
--   even after status='completed' — but only for assignments the lead never
--   touched.
--
-- Safe to re-run.
-- ============================================

ALTER TABLE swim_jobs
  ADD COLUMN IF NOT EXISTS auto_award_on_signup BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE swim_assignments
  ADD COLUMN IF NOT EXISTS auto_awarded BOOLEAN NOT NULL DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';
