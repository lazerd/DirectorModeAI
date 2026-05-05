-- ============================================
-- Multi-day tournament scheduling
-- ============================================
-- Tournaments span multiple days. Adds:
--   - events.end_date              — last day of the tournament window (start_date already exists via event_date semantics)
--   - events.daily_start_time      — when each day begins (e.g. 09:00)
--   - events.daily_end_time        — when each day ends (e.g. 18:00)
--   - events.default_match_length_minutes — used by the auto-scheduler
--   - events.player_rest_minutes   — minimum gap between a player's matches
--   - events.match_buffer_minutes  — gap between dependent matches (winner needs warm-up before next)
--   - quad_matches.scheduled_date / tournament_matches.scheduled_date — DATE companion to scheduled_at TIME
--
-- We KEEP events.event_date as the "start date" of the tournament for
-- backwards compatibility — single-day events have event_date == end_date.
-- The auto-scheduler treats event_date as start_date.
--
-- Safe to re-run.
-- ============================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS end_date DATE,
  ADD COLUMN IF NOT EXISTS daily_start_time TIME,
  ADD COLUMN IF NOT EXISTS daily_end_time TIME,
  ADD COLUMN IF NOT EXISTS default_match_length_minutes INTEGER NOT NULL DEFAULT 90
    CHECK (default_match_length_minutes BETWEEN 5 AND 480),
  ADD COLUMN IF NOT EXISTS player_rest_minutes INTEGER NOT NULL DEFAULT 60
    CHECK (player_rest_minutes BETWEEN 0 AND 480),
  ADD COLUMN IF NOT EXISTS match_buffer_minutes INTEGER NOT NULL DEFAULT 30
    CHECK (match_buffer_minutes BETWEEN 0 AND 240);

-- Backfill: events without end_date treat event_date as a single-day window
UPDATE events
SET end_date = event_date
WHERE end_date IS NULL AND event_date IS NOT NULL;

-- Per-match date columns
ALTER TABLE quad_matches
  ADD COLUMN IF NOT EXISTS scheduled_date DATE;

ALTER TABLE tournament_matches
  ADD COLUMN IF NOT EXISTS scheduled_date DATE;

CREATE INDEX IF NOT EXISTS idx_quad_matches_scheduled
  ON quad_matches(scheduled_date, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_tournament_matches_scheduled
  ON tournament_matches(scheduled_date, scheduled_at);
