-- ============================================
-- JTT: stop the matchup recompute from firing on player-assignment updates
-- ============================================
-- recompute_matchup_from_lines() re-tallies the team score and UPDATEs the
-- parent league_team_matchups row. The old trigger fired it on EVERY line
-- UPDATE — including setting home_player1_id etc. during auto-assign. When the
-- lineup builder wrote several lines at once, each fire updated the SAME matchup
-- row, so the writes contended on that row's lock until one hit the statement
-- timeout ("canceling statement due to statement timeout").
--
-- Only winner / status / counts_for_team affect the tally, so the UPDATE trigger
-- now fires only when one of those actually changes. Assigning players touches
-- the matchup row zero times → no contention, and single assigns get faster too.
--
-- Safe to re-run. Apply after leagues_jtt_mixed_lines.sql.
-- ============================================

DROP TRIGGER IF EXISTS trg_lines_recompute_matchup ON league_matchup_lines;
DROP TRIGGER IF EXISTS trg_lines_recompute_matchup_ins ON league_matchup_lines;
DROP TRIGGER IF EXISTS trg_lines_recompute_matchup_upd ON league_matchup_lines;

-- Inserts and deletes always change the set of lines → always recompute.
CREATE TRIGGER trg_lines_recompute_matchup_ins
  AFTER INSERT OR DELETE ON league_matchup_lines
  FOR EACH ROW EXECUTE FUNCTION recompute_matchup_from_lines();

-- Updates recompute only when a tally-affecting column changes — NOT when only
-- player slots / court labels / tokens change.
CREATE TRIGGER trg_lines_recompute_matchup_upd
  AFTER UPDATE ON league_matchup_lines
  FOR EACH ROW
  WHEN (
    OLD.winner IS DISTINCT FROM NEW.winner
    OR OLD.status IS DISTINCT FROM NEW.status
    OR OLD.counts_for_team IS DISTINCT FROM NEW.counts_for_team
    OR OLD.matchup_id IS DISTINCT FROM NEW.matchup_id
  )
  EXECUTE FUNCTION recompute_matchup_from_lines();
