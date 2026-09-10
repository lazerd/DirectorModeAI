-- =====================================================================
-- How many courts a match is played on at once.
--
-- For Junior Team Tennis this decides the round structure of the sheet:
--   2 courts: S1+D1 | S2+D2 | S3+D3 | S4+D4            (4 rounds)
--   3 courts: S1+S2+D1 | S3+S4+D2 | D3+D4              (3 rounds)
-- and a child can never be on two lines in the same round.
--
-- The HOST decides (it is a question of how many courts they have), so it
-- lives on the match. NULL = fall back to captain_teams.court_format.
--
-- Run: node scripts/dbrun.mjs supabase/migrations/captain_match_court_format.sql
-- Safe to re-run.
-- =====================================================================

ALTER TABLE captain_matches
  ADD COLUMN IF NOT EXISTS court_format INT;

ALTER TABLE captain_matches DROP CONSTRAINT IF EXISTS captain_matches_court_format_check;
ALTER TABLE captain_matches
  ADD CONSTRAINT captain_matches_court_format_check
  CHECK (court_format IS NULL OR court_format BETWEEN 1 AND 8);
