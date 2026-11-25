-- Clinic signups + reminders (11/25/26). The TopDog feature directors don't want to lose:
-- members say "I'm in" for ONE clinic date, the director (or the AI staff) sends the
-- signed-up players a reminder with one tap, and when spots are still open the day
-- before, the clinic's regulars who haven't signed up get "2 spots left Friday".
--
--   club_program_meeting_signups  one row per person per clinic date ('in' or 'out').
--   club_program_meeting_sends    one row per reminder/nudge actually sent, so the
--                                 daily auto-run never sends the same one twice.
--   club_programs.auto_reminders  the director's "do it for me" switch.
--   club_programs.meeting_capacity spots per clinic date (falls back to capacity).

CREATE TABLE IF NOT EXISTS club_program_meeting_signups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id       uuid NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  program_id    uuid NOT NULL REFERENCES club_programs(id) ON DELETE CASCADE,
  meeting_date  date NOT NULL,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  email         text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
  person_key    text NOT NULL,
  status        text NOT NULL DEFAULT 'in' CHECK (status IN ('in','out')),
  source        text NOT NULL DEFAULT 'web' CHECK (source IN ('web','email','staff')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, meeting_date, person_key)
);
CREATE INDEX IF NOT EXISTS idx_cpms_program_date ON club_program_meeting_signups (program_id, meeting_date);
CREATE INDEX IF NOT EXISTS idx_cpms_club_email ON club_program_meeting_signups (club_id, lower(email));

CREATE TABLE IF NOT EXISTS club_program_meeting_sends (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id       uuid NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  program_id    uuid NOT NULL REFERENCES club_programs(id) ON DELETE CASCADE,
  meeting_date  date NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('reminder','spots_left')),
  sent_count    int NOT NULL DEFAULT 0,
  spots_left    int,
  auto          boolean NOT NULL DEFAULT false,
  sent_by       uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cpmsend_program_date ON club_program_meeting_sends (program_id, meeting_date, kind);

ALTER TABLE club_programs ADD COLUMN IF NOT EXISTS auto_reminders boolean NOT NULL DEFAULT false;
ALTER TABLE club_programs ADD COLUMN IF NOT EXISTS meeting_capacity int;

ALTER TABLE club_program_meeting_signups ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_program_meeting_sends   ENABLE ROW LEVEL SECURITY;
