-- Public score self-entry for mixer events only.
-- Scoped to the `matches` table (mixer events). Compass-draw / round-robin /
-- single-elim leagues use the separate `league_matches` table and are
-- untouched.
--
-- Two layers of restriction:
--   1. Column grant — anon can only write to score-related columns. Player
--      IDs, court numbers, round_id, etc. stay protected.
--   2. RLS policy — only matches whose round is currently `in_progress`.
--      Past (completed) and future (upcoming) rounds are off-limits.

GRANT UPDATE (team1_score, team2_score, winner_team, tiebreaker_winner) ON matches TO anon;

DROP POLICY IF EXISTS matches_anon_update_scores ON matches;
CREATE POLICY matches_anon_update_scores ON matches FOR UPDATE TO anon
  USING (
    EXISTS (
      SELECT 1 FROM rounds
      WHERE rounds.id = matches.round_id
        AND rounds.status = 'in_progress'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM rounds
      WHERE rounds.id = matches.round_id
        AND rounds.status = 'in_progress'
    )
  );
