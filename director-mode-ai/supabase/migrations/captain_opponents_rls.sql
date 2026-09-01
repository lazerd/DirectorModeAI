-- captain_opponents shipped with RLS disabled. It holds opposing captains'
-- names, email addresses and mobile numbers — real people at other clubs — so
-- until this runs, any authenticated user could read every club's contact book
-- with the public anon key.
--
-- Mirrors captain_matches exactly: one FOR ALL policy on captain_can_access_team(),
-- which already encodes "the captain who owns this team, plus its co-captains".
ALTER TABLE captain_opponents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "captain team scope" ON captain_opponents;
CREATE POLICY "captain team scope" ON captain_opponents
  FOR ALL
  USING (captain_can_access_team(team_id))
  WITH CHECK (captain_can_access_team(team_id));
