-- ============================================
-- JTT: editable court names on match-day scorecards.
--
-- NULL = default display ("Court 1", "Court 2", ... by position within the
-- round). A label is free text ("Court 5", "Stadium", "Upper 2") and is shown
-- on the facilitator page, the coach match-day page, and the public box score.
--
-- Safe to re-run. Apply after leagues_jtt_rounds.sql.
-- ============================================

ALTER TABLE league_matchup_lines
  ADD COLUMN IF NOT EXISTS court_label TEXT;
