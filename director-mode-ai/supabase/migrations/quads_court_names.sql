-- ============================================
-- Quads: per-event named court list
-- ============================================
-- Replaces the implicit "courts numbered 1..num_courts" model with an
-- explicit list of court labels the director controls (e.g. ['1','2','3','5']
-- if court 4 is reserved for lessons, or ['Stadium','Bubble','Court A']
-- for clubs with named courts).
--
-- num_courts column is kept (legacy fallback). If court_names is NULL or
-- empty, the auto-scheduler falls back to ['1'..String(num_courts)].
--
-- Safe to re-run.
-- ============================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS court_names TEXT[];
