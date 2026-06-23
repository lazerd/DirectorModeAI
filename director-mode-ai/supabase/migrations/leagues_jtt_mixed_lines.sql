-- ============================================
-- JTT mixed-club lines (count for individual records, NOT the team record)
-- ============================================
-- When the numbers are uneven a court can be mixed (e.g. an SH player paired
-- with an OCC player). That line still records a winning SIDE so the players'
-- individual records are right, but it must NOT count toward either team's
-- match score. `counts_for_team = false` marks such a line; the recompute
-- trigger then ignores it when tallying the team result.
--
-- Safe to re-run. Apply after leagues_jtt.sql.
-- ============================================

ALTER TABLE league_matchup_lines
  ADD COLUMN IF NOT EXISTS counts_for_team BOOLEAN NOT NULL DEFAULT TRUE;

CREATE OR REPLACE FUNCTION recompute_matchup_from_lines() RETURNS TRIGGER AS $$
DECLARE
  v_home INTEGER;
  v_away INTEGER;
  v_total INTEGER;
  v_completed INTEGER;
  v_matchup_id UUID;
BEGIN
  v_matchup_id := COALESCE(NEW.matchup_id, OLD.matchup_id);

  -- Only team-counting lines feed the team score + completion. Mixed lines
  -- (counts_for_team = false) are scored for individuals but invisible here.
  SELECT
    COUNT(*) FILTER (WHERE winner = 'home' AND counts_for_team),
    COUNT(*) FILTER (WHERE winner = 'away' AND counts_for_team),
    COUNT(*) FILTER (WHERE counts_for_team),
    COUNT(*) FILTER (WHERE status = 'completed' AND counts_for_team)
  INTO v_home, v_away, v_total, v_completed
  FROM league_matchup_lines
  WHERE matchup_id = v_matchup_id;

  UPDATE league_team_matchups
  SET
    home_lines_won = v_home,
    away_lines_won = v_away,
    winner = CASE
      WHEN v_completed < v_total THEN NULL
      WHEN v_home > v_away THEN 'home'
      WHEN v_away > v_home THEN 'away'
      ELSE 'tie'
    END,
    status = CASE
      WHEN v_completed = 0 THEN status
      WHEN v_completed < v_total THEN 'in_progress'
      ELSE 'completed'
    END,
    updated_at = NOW()
  WHERE id = v_matchup_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lines_recompute_matchup ON league_matchup_lines;
CREATE TRIGGER trg_lines_recompute_matchup
  AFTER INSERT OR UPDATE OR DELETE ON league_matchup_lines
  FOR EACH ROW EXECUTE FUNCTION recompute_matchup_from_lines();
