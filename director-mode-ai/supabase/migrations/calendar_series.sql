-- ============================================
-- CalendarMode — a recurring series is ONE item, not N rows
-- ============================================
-- Repeating a weekly event (a five-week Summer Slam) used to create five
-- separate calendar_items — "Summer Slam #1..#5". Works, but the year list
-- then shows five rows for one thing, which is exactly the clutter the
-- one-page list was meant to avoid.
--
-- A series is now a SINGLE item that carries all its occurrence dates:
--   target_date   = the first occurrence (so it sorts and places normally)
--   series_dates  = every occurrence, ISO 'YYYY-MM-DD', ascending
--                   ([] = an ordinary one-off event)
--
-- Reminders, holds and promotion still key off target_date for now; the list
-- renders the whole series as one expandable row. Kept as a jsonb array rather
-- than a child table because a series is small (a season of Thursdays) and
-- always read and written with its parent.
--
-- Safe to re-run.
-- ============================================

ALTER TABLE calendar_items
  ADD COLUMN IF NOT EXISTS series_dates JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN calendar_items.series_dates IS
  'Occurrence dates for a recurring event, ISO YYYY-MM-DD ascending. Empty = a single event (target_date is the date). When set, target_date is the first occurrence.';
