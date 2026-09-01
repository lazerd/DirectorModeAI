-- Match recap: the email that goes out to the TEAM after a match is played.
--
-- Every other CaptainMode email is pre-match. Nothing existed for afterwards,
-- so the scores a captain typed in went into the app and nowhere else, and the
-- team found out how they did by texting each other.
--
-- Two voices, because one tone cannot carry both results: a win recap that
-- celebrates and a loss recap that picks the team up. Stored per team so a
-- captain writes her own words once and every match after that is one tap.

ALTER TABLE captain_matches
  ADD COLUMN IF NOT EXISTS recap_sent_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS captain_recap_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid NOT NULL REFERENCES captain_teams(id) ON DELETE CASCADE,
  -- 'tie' is rarer than the other two but a 3-3 recap written in the winning
  -- voice reads as a lie, so it gets its own row rather than borrowing one.
  outcome    text NOT NULL CHECK (outcome IN ('win','loss','tie')),
  subject    text,
  body       text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, outcome)
);
CREATE INDEX IF NOT EXISTS captain_recap_templates_team_idx ON captain_recap_templates(team_id);

ALTER TABLE captain_recap_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "captain team scope" ON captain_recap_templates;
CREATE POLICY "captain team scope" ON captain_recap_templates FOR ALL TO authenticated
  USING (captain_can_access_team(team_id))
  WITH CHECK (captain_can_access_team(team_id));
