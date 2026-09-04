-- =====================================================================
-- Default lines per match, on the team.
--
-- How many singles and doubles courts a team match is played over was
-- hardcoded in three places: `?? 2` / `?? 3` in the matches API and the match
-- page, `0` / `4` in the paste importer (which is the East Bay Women's Tennis
-- League's shape, not a universal one), and `2` / `3` in the add-match form.
--
-- Junior Team Tennis plays 2 singles + 2 doubles, so the hardcoding had to go.
-- The number now lives on the team, seeded from its league when the team is
-- created and editable in team settings; a null falls back to the league
-- default in src/lib/captain/leagues.ts.
--
-- Run: node scripts/dbrun.mjs supabase/migrations/captain_team_lines.sql
-- Safe to re-run.
-- =====================================================================

ALTER TABLE captain_teams
  ADD COLUMN IF NOT EXISTS default_singles_courts int,
  ADD COLUMN IF NOT EXISTS default_doubles_courts int;

ALTER TABLE captain_teams DROP CONSTRAINT IF EXISTS captain_teams_default_lines_check;
ALTER TABLE captain_teams
  ADD CONSTRAINT captain_teams_default_lines_check
  CHECK (
    (default_singles_courts IS NULL OR default_singles_courts BETWEEN 0 AND 8)
    AND (default_doubles_courts IS NULL OR default_doubles_courts BETWEEN 0 AND 8)
  );

-- Backfill the one team that already has a season loaded, so this migration
-- cannot change what its next imported match looks like. Fall B2/B3 is a
-- 4-doubles-line league with no singles.
UPDATE captain_teams
   SET default_singles_courts = 0,
       default_doubles_courts = 4
 WHERE id = '517c278c-3878-49be-83fd-a8faa2ab99d0'
   AND default_doubles_courts IS NULL;

-- ---------------------------------------------------------------------
-- The league site's own id for this team.
--
-- A Junior Team Tennis captain hands this number out all season: a parent
-- registers on TennisLink by typing the Team ID, their USTA number and paying
-- the fee. It was living in a memory file and a text message thread.
-- ---------------------------------------------------------------------
ALTER TABLE captain_teams
  ADD COLUMN IF NOT EXISTS source_team_id text;
