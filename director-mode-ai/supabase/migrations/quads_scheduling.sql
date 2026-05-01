-- ============================================
-- Quads scheduling — per-match start time + per-event round duration
-- ============================================
-- Adds:
--   - quad_matches.scheduled_at TIME (HH:MM, no date — implicit from event_date)
--   - events.round_duration_minutes (used by the auto-schedule helper)
--
-- Safe to re-run.
-- ============================================

ALTER TABLE quad_matches
  ADD COLUMN IF NOT EXISTS scheduled_at TIME;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS round_duration_minutes INTEGER NOT NULL DEFAULT 45
    CHECK (round_duration_minutes BETWEEN 5 AND 240);
