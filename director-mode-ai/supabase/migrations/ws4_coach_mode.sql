-- =====================================================================
-- WS4 · Coach Mode — lesson development tracking + AI lesson summaries
--
-- Adds post-lesson capture (the piece the audit found missing) and a
-- lightweight per-player skill history for progress tracking. No video —
-- that stays in the standalone CoachModeV3 app.
--
-- Run in Supabase -> SQL editor. Re-runnable.
-- =====================================================================

-- Per-lesson recap + AI summary.
CREATE TABLE IF NOT EXISTS lesson_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id     uuid NOT NULL REFERENCES lesson_coaches(id) ON DELETE CASCADE,
  client_id    uuid REFERENCES lesson_clients(id) ON DELETE SET NULL,
  slot_id      uuid REFERENCES lesson_slots(id) ON DELETE SET NULL,
  club_id      uuid REFERENCES cc_clubs(id),
  lesson_date  date NOT NULL DEFAULT current_date,
  focus_area   text,
  content      text,               -- coach's raw notes
  ai_summary   text,               -- AI-generated recap
  created_by   uuid,               -- auth.uid() of author
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lesson_notes_coach_idx  ON lesson_notes(coach_id);
CREATE INDEX IF NOT EXISTS lesson_notes_client_idx ON lesson_notes(client_id);

-- Point-in-time skill ratings so a player's development is a timeline.
CREATE TABLE IF NOT EXISTS lesson_skill_snapshots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES lesson_clients(id) ON DELETE CASCADE,
  coach_id    uuid REFERENCES lesson_coaches(id) ON DELETE SET NULL,
  club_id     uuid REFERENCES cc_clubs(id),
  note_id     uuid REFERENCES lesson_notes(id) ON DELETE SET NULL,
  skill       text NOT NULL,        -- e.g. 'serve','forehand','movement','strategy'
  rating      int  NOT NULL CHECK (rating BETWEEN 1 AND 10),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS skill_snap_client_idx ON lesson_skill_snapshots(client_id, skill, recorded_at);

-- RLS: a coach manages their own notes/snapshots; club members can read them.
ALTER TABLE lesson_notes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_skill_snapshots  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coach manages own lesson notes" ON lesson_notes;
CREATE POLICY "coach manages own lesson notes" ON lesson_notes
  FOR ALL TO authenticated
  USING (
    is_club_member(club_id)
    OR EXISTS (SELECT 1 FROM lesson_coaches lc WHERE lc.id = lesson_notes.coach_id AND lc.profile_id = auth.uid())
  )
  WITH CHECK (
    is_club_member(club_id)
    OR EXISTS (SELECT 1 FROM lesson_coaches lc WHERE lc.id = lesson_notes.coach_id AND lc.profile_id = auth.uid())
  );

DROP POLICY IF EXISTS "coach manages own skill snapshots" ON lesson_skill_snapshots;
CREATE POLICY "coach manages own skill snapshots" ON lesson_skill_snapshots
  FOR ALL TO authenticated
  USING (
    is_club_member(club_id)
    OR EXISTS (SELECT 1 FROM lesson_coaches lc WHERE lc.id = lesson_skill_snapshots.coach_id AND lc.profile_id = auth.uid())
  )
  WITH CHECK (
    is_club_member(club_id)
    OR EXISTS (SELECT 1 FROM lesson_coaches lc WHERE lc.id = lesson_skill_snapshots.coach_id AND lc.profile_id = auth.uid())
  );

-- Let a client read their OWN development (for the member progress view).
DROP POLICY IF EXISTS "client reads own lesson notes" ON lesson_notes;
CREATE POLICY "client reads own lesson notes" ON lesson_notes
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM lesson_clients c WHERE c.id = lesson_notes.client_id AND c.profile_id = auth.uid()));

DROP POLICY IF EXISTS "client reads own skill snapshots" ON lesson_skill_snapshots;
CREATE POLICY "client reads own skill snapshots" ON lesson_skill_snapshots
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM lesson_clients c WHERE c.id = lesson_skill_snapshots.client_id AND c.profile_id = auth.uid()));
