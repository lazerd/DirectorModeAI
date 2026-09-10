-- =====================================================================
-- How a team match is decided.
--
--   courts  — most courts won takes the match (USTA style). The default.
--   topdog  — points per court, the way TopDog / EBWT leagues score it:
--               straight-set win 3 · 3-set win 2 · 3-set loss 1 · straight-set loss 0
--             (a defaulted court is 3-0). A 2-2 split on courts can be an 8-4 win.
--
-- Decides which recap template is used, the score it prints, and the season
-- record. Fall B2/B3 (TopDog) is switched on below.
--
-- Run: node scripts/dbrun.mjs supabase/migrations/captain_team_match_scoring.sql
-- Safe to re-run.
-- =====================================================================

ALTER TABLE captain_teams
  ADD COLUMN IF NOT EXISTS match_scoring TEXT NOT NULL DEFAULT 'courts';

ALTER TABLE captain_teams DROP CONSTRAINT IF EXISTS captain_teams_match_scoring_check;
ALTER TABLE captain_teams
  ADD CONSTRAINT captain_teams_match_scoring_check
  CHECK (match_scoring IN ('courts', 'topdog'));

UPDATE captain_teams SET match_scoring = 'topdog'
 WHERE id = '517c278c-3878-49be-83fd-a8faa2ab99d0';
