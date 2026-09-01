-- Open Times: the coach's own Google Calendar is the booking surface.
--
-- LastMinuteLessonMode PUSHES — a cancellation lands, the coach blasts it to
-- his clients, first to claim gets it. This is the PULL half: an event titled
-- "Open" sitting on his calendar becomes a slot on a page his clients can book
-- from any time, with no blast and nothing for him to enter twice.
--
-- The calendar stays the source of truth in both directions: booking renames
-- the event to the client's name, so the coach sees it in the app he actually
-- lives in, and the sync stops offering it because it is no longer called
-- "Open".

ALTER TABLE lesson_coaches
  -- Usually the coach's own email address; a dedicated calendar also works.
  ADD COLUMN IF NOT EXISTS google_calendar_id  text,
  -- Title prefix that means "bookable". Keyword only, so "Open $95 · 60 min"
  -- still counts and the rest of the title becomes the slot's note.
  ADD COLUMN IF NOT EXISTS open_keyword        text NOT NULL DEFAULT 'Open',
  ADD COLUMN IF NOT EXISTS open_page_enabled   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS open_page_note      text,
  -- Nobody books a lesson that starts in ten minutes.
  ADD COLUMN IF NOT EXISTS booking_lead_hours  integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS timezone            text NOT NULL DEFAULT 'America/Los_Angeles',
  ADD COLUMN IF NOT EXISTS open_synced_at      timestamptz;

ALTER TABLE lesson_slots
  -- 'manual' (typed into the app) or 'google' (mirrored from a calendar event).
  ADD COLUMN IF NOT EXISTS source            text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS google_event_id   text,
  ADD COLUMN IF NOT EXISTS google_calendar_id text,
  -- A client booking off the public page has no account: name and email are
  -- all we ask for, because a login is the thing that stops people booking.
  ADD COLUMN IF NOT EXISTS guest_name        text,
  ADD COLUMN IF NOT EXISTS guest_email       text,
  ADD COLUMN IF NOT EXISTS guest_phone       text,
  ADD COLUMN IF NOT EXISTS guest_note        text,
  -- Whatever the coach wrote after the keyword, e.g. "$95 · 60 min".
  ADD COLUMN IF NOT EXISTS open_note         text;

-- One slot per calendar event. Re-syncing must update, never duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS lesson_slots_google_event_idx
  ON lesson_slots (coach_id, google_event_id)
  WHERE google_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS lesson_slots_coach_start_idx ON lesson_slots (coach_id, start_time);

-- The public page is addressed by slug, so it has to be unique and present.
CREATE UNIQUE INDEX IF NOT EXISTS lesson_coaches_slug_idx ON lesson_coaches (slug) WHERE slug IS NOT NULL;
