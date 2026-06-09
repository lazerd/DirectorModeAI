-- ============================================
-- JTT: let any signed-in coach run match day (not just the league director).
--
-- The original "Directors manage ..." policies restrict writes to
-- league.director_id = auth.uid(). For Lamorinda-style JTT, every club's
-- coach needs to check players in, set lineups, adjust courts/rounds, and
-- enter scores. These policies add a parallel grant: any AUTHENTICATED user
-- may manage rows that belong to a TEAM-format league. Individual-format
-- leagues are unaffected (still director-only).
--
-- RLS policies are permissive/OR-ed, so the director policies still apply too.
-- Safe to re-run.
-- ============================================

-- Lines (lineups + scores + courts/rounds structure)
DROP POLICY IF EXISTS "Coaches manage lines" ON league_matchup_lines;
CREATE POLICY "Coaches manage lines" ON league_matchup_lines
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_team_matchups m
      JOIN league_divisions d ON d.id = m.division_id
      JOIN leagues l ON l.id = d.league_id
      WHERE m.id = matchup_id AND l.format = 'team'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM league_team_matchups m
      JOIN league_divisions d ON d.id = m.division_id
      JOIN leagues l ON l.id = d.league_id
      WHERE m.id = matchup_id AND l.format = 'team'
    )
  );

-- Check-ins (match-day attendance)
DROP POLICY IF EXISTS "Coaches manage checkins" ON league_matchup_checkins;
CREATE POLICY "Coaches manage checkins" ON league_matchup_checkins
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_team_matchups m
      JOIN league_divisions d ON d.id = m.division_id
      JOIN leagues l ON l.id = d.league_id
      WHERE m.id = matchup_id AND l.format = 'team'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM league_team_matchups m
      JOIN league_divisions d ON d.id = m.division_id
      JOIN leagues l ON l.id = d.league_id
      WHERE m.id = matchup_id AND l.format = 'team'
    )
  );

-- Matchups (courts_override, notes, status)
DROP POLICY IF EXISTS "Coaches manage matchups" ON league_team_matchups;
CREATE POLICY "Coaches manage matchups" ON league_team_matchups
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_divisions d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = division_id AND l.format = 'team'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM league_divisions d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = division_id AND l.format = 'team'
    )
  );

-- Rosters (add/remove/reorder players)
DROP POLICY IF EXISTS "Coaches manage rosters" ON league_team_rosters;
CREATE POLICY "Coaches manage rosters" ON league_team_rosters
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM league_divisions d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = division_id AND l.format = 'team'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM league_divisions d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = division_id AND l.format = 'team'
    )
  );
