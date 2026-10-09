-- ============================================
-- Class attendance: who came to each meeting of a class.
-- ============================================
-- ClubMode had classes (club_programs), their meeting dates (computed by
-- lib/programs/sessions.ts, nothing stored) and season sign-ups
-- (club_program_registrations), but nowhere to record who actually turned up.
-- The director's two most frequent asks, "attendance for tonight's clinic:
-- Chitra, Kersti, Leena" and "who needs the drop-in charge?", both need it.
--
-- Two tables:
--
--   club_program_extra_meetings  an unscheduled session ("we ran an extra one
--                                tonight"), the extra column on the sheet.
--                                makes_up_for = the rained-out date it
--                                replaces, which makes it count toward what a
--                                season sign-up is owed.
--   club_program_attendance      one row per person per meeting.
--
-- WHO a row is: person_key is 'reg:<registration id>' for someone on the
-- roster, 'vault:<cc_vault_players id>' for a known person who is not, and
-- 'name:<lowercased name>' only for a guest the director confirmed is not in
-- ClubMode. Never an email (households share inboxes).
--
-- is_makeup / paid_outside_*: the two ways a drop-in is settled without a
-- charge: "count tonight as a makeup" and "she Venmo'd me".
--
-- Written by the Ask Claude attendance pack. NOT YET RUN. Safe to re-run.
-- ============================================

CREATE TABLE IF NOT EXISTS club_program_extra_meetings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id       UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  program_id    UUID NOT NULL REFERENCES club_programs(id) ON DELETE CASCADE,
  meeting_date  DATE NOT NULL,
  makes_up_for  DATE,
  note          TEXT,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (program_id, meeting_date)
);

CREATE INDEX IF NOT EXISTS idx_cpem_club ON club_program_extra_meetings(club_id);

CREATE TABLE IF NOT EXISTS club_program_attendance (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id            UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  program_id         UUID NOT NULL REFERENCES club_programs(id) ON DELETE CASCADE,
  meeting_date       DATE NOT NULL,
  name               TEXT NOT NULL,
  person_key         TEXT NOT NULL,
  registration_id    UUID REFERENCES club_program_registrations(id) ON DELETE SET NULL,
  vault_player_id    UUID REFERENCES cc_vault_players(id) ON DELETE SET NULL,
  is_makeup          BOOLEAN NOT NULL DEFAULT FALSE,
  makeup_note        TEXT,
  paid_outside_at    TIMESTAMPTZ,
  paid_outside_note  TEXT,
  marked_by          UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One mark per person per meeting: a second "Chitra was here" is a no-op.
  UNIQUE (program_id, meeting_date, person_key)
);

CREATE INDEX IF NOT EXISTS idx_cpa_club_date ON club_program_attendance(club_id, meeting_date);
CREATE INDEX IF NOT EXISTS idx_cpa_program_person ON club_program_attendance(program_id, person_key);

ALTER TABLE club_program_extra_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE club_program_attendance ENABLE ROW LEVEL SECURITY;

-- Staff only, same shape as club_program_registrations. No public policy.
DROP POLICY IF EXISTS cpem_staff_all ON club_program_extra_meetings;
CREATE POLICY cpem_staff_all ON club_program_extra_meetings
  FOR ALL USING (is_club_team(club_id));

DROP POLICY IF EXISTS cpem_owner_all ON club_program_extra_meetings;
CREATE POLICY cpem_owner_all ON club_program_extra_meetings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM cc_clubs c
            WHERE c.id = club_program_extra_meetings.club_id AND c.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS cpa_staff_all ON club_program_attendance;
CREATE POLICY cpa_staff_all ON club_program_attendance
  FOR ALL USING (is_club_team(club_id));

DROP POLICY IF EXISTS cpa_owner_all ON club_program_attendance;
CREATE POLICY cpa_owner_all ON club_program_attendance
  FOR ALL USING (
    EXISTS (SELECT 1 FROM cc_clubs c
            WHERE c.id = club_program_attendance.club_id AND c.owner_id = auth.uid())
  );
