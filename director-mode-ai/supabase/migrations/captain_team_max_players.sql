-- =====================================================================
-- The most players a team brings to one match.
--
-- JTT: 12 slots, up to 3 lines each. Past 6 kids somebody drives to the
-- match for a single short set — so when more say yes than the team can
-- bring, the lineup generator picks who sits (fewest matches this season
-- plays first, then fewest other available dates, then earliest signup).
--
-- NULL = the league default (6 for JTT; no cap for adult leagues, where
-- each player takes one line anyway).
--
-- Run: node scripts/dbrun.mjs supabase/migrations/captain_team_max_players.sql
-- Safe to re-run.
-- =====================================================================

ALTER TABLE captain_teams
  ADD COLUMN IF NOT EXISTS max_players INT;

ALTER TABLE captain_teams DROP CONSTRAINT IF EXISTS captain_teams_max_players_check;
ALTER TABLE captain_teams
  ADD CONSTRAINT captain_teams_max_players_check
  CHECK (max_players IS NULL OR max_players BETWEEN 1 AND 30);
