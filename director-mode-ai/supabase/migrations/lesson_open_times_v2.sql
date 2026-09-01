-- Open Lesson Time, club-wide.
--
-- Reshaped from one-event-one-slot to WINDOWS. An instructor blocks out
-- "Open Lesson Time" 1:00–4:00pm; a client books 60 minutes at 2:00. So the
-- calendar event is availability, not a fixed appointment, and the app carves
-- bookings out of it.
--
-- Every instructor at the club connects their own calendar; the app knows whose
-- is whose because the calendar id is stored on their coach row, and the club
-- page shows them all side by side.

CREATE TABLE IF NOT EXISTS lesson_open_windows (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id           uuid NOT NULL REFERENCES lesson_coaches(id) ON DELETE CASCADE,
  club_id            uuid,
  google_event_id    text NOT NULL,
  google_calendar_id text NOT NULL,
  start_time         timestamptz NOT NULL,
  end_time           timestamptz NOT NULL,
  location           text,
  synced_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (coach_id, google_event_id)
);
CREATE INDEX IF NOT EXISTS lesson_open_windows_coach_idx ON lesson_open_windows (coach_id, start_time);
CREATE INDEX IF NOT EXISTS lesson_open_windows_club_idx  ON lesson_open_windows (club_id, start_time);

ALTER TABLE lesson_open_windows ENABLE ROW LEVEL SECURITY;
-- Reads and writes go through service-role API routes (the booking page has no
-- login at all), so no authenticated policy is granted here on purpose.

ALTER TABLE lesson_coaches
  -- The exact event title an instructor types. Exact, not a prefix: "Open
  -- Lesson Time" is unambiguous, and a prefix match turns "Open house" into a
  -- bookable lesson.
  ADD COLUMN IF NOT EXISTS open_durations integer[] NOT NULL DEFAULT '{30,60,90}',
  ADD COLUMN IF NOT EXISTS open_rate_note text;

UPDATE lesson_coaches SET open_keyword = 'Open Lesson Time'
  WHERE open_keyword IS NULL OR open_keyword IN ('Open', '');
ALTER TABLE lesson_coaches ALTER COLUMN open_keyword SET DEFAULT 'Open Lesson Time';

ALTER TABLE lesson_slots
  -- Which availability window this booking was carved out of, so the sync can
  -- subtract it and the calendar can be put back together on a cancellation.
  ADD COLUMN IF NOT EXISTS window_event_id text;

-- The club-wide page is addressed by the club slug; instructors opt in per coach.
ALTER TABLE cc_clubs
  ADD COLUMN IF NOT EXISTS open_lessons_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS open_lessons_note text;

-- Two clients tapping the same 2:00pm within the same second is exactly where a
-- booking system fails, and application-level checks lose that race. Postgres
-- settles it: no two BOOKED open-lesson slots for one coach may overlap.
-- Scoped to window bookings (window_event_id IS NOT NULL) so historical
-- manually-entered slots, which include duplicates, are left alone.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE lesson_slots DROP CONSTRAINT IF EXISTS lesson_slots_open_no_double_book;
ALTER TABLE lesson_slots ADD CONSTRAINT lesson_slots_open_no_double_book
  EXCLUDE USING gist (coach_id WITH =, tstzrange(start_time, end_time) WITH &&)
  WHERE (status = 'booked' AND window_event_id IS NOT NULL);
