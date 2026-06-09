-- ============================================
-- JTT match-day "rounds": group a matchup's score lines into rounds so a
-- coach can run Round 1 (one line per court), then add Round 2, etc.
--
-- line_number stays GLOBALLY UNIQUE within a matchup (existing
-- UNIQUE(matchup_id, line_number) is untouched) — rounds are a grouping/
-- display concept. The scoring trigger already aggregates ALL lines in a
-- matchup, so every round's courts count toward the team score.
--
-- Safe to re-run. Apply after leagues_jtt.sql.
-- ============================================

ALTER TABLE league_matchup_lines
  ADD COLUMN IF NOT EXISTS round_number INTEGER NOT NULL DEFAULT 1
  CHECK (round_number >= 1);

CREATE INDEX IF NOT EXISTS idx_lines_round
  ON league_matchup_lines(matchup_id, round_number);
