-- ============================================
-- JTT per-matchup check-in + court counts + dynamic line generation
-- ============================================
-- Rosters are the season roster; check-ins are match-day attendance.
-- Presence in league_matchup_checkins = player is here today.
--
-- Also adds court capacity to clubs (with per-matchup override) so the
-- line optimizer can compute the right mix of singles/doubles per
-- matchup based on attendance + courts available at the host club.
--
-- Safe to re-run. Apply after leagues_jtt.sql.
-- ============================================

-- Courts per club (default capacity)
ALTER TABLE league_clubs
  ADD COLUMN IF NOT EXISTS courts_available INTEGER NOT NULL DEFAULT 4
  CHECK (courts_available BETWEEN 0 AND 50);

-- Per-matchup override (e.g. rain took a court, tournament eats courts)
ALTER TABLE league_team_matchups
  ADD COLUMN IF NOT EXISTS courts_override INTEGER
  CHECK (courts_override IS NULL OR courts_override BETWEEN 0 AND 50);

CREATE TABLE IF NOT EXISTS league_matchup_checkins (
  matchup_id UUID NOT NULL REFERENCES league_team_matchups(id) ON DELETE CASCADE,
  roster_id UUID NOT NULL REFERENCES league_team_rosters(id) ON DELETE CASCADE,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (matchup_id, roster_id)
);

CREATE INDEX IF NOT EXISTS idx_checkins_matchup ON league_matchup_checkins(matchup_id);
CREATE INDEX IF NOT EXISTS idx_checkins_roster ON league_matchup_checkins(roster_id);

ALTER TABLE league_matchup_checkins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Directors manage checkins" ON league_matchup_checkins;
CREATE POLICY "Directors manage checkins" ON league_matchup_checkins
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM league_team_matchups m
      JOIN league_divisions d ON d.id = m.division_id
      JOIN leagues l ON l.id = d.league_id
      WHERE m.id = matchup_id AND l.director_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Public can view checkins" ON league_matchup_checkins;
CREATE POLICY "Public can view checkins" ON league_matchup_checkins
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM league_team_matchups m
      JOIN league_divisions d ON d.id = m.division_id
      JOIN leagues l ON l.id = d.league_id
      WHERE m.id = matchup_id AND l.status IN ('running','completed')
    )
  );
