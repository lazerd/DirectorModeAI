-- =====================================================================
-- Sleepy Hollow's three Fall 2026 Junior Team Tennis teams, into CaptainMode.
--
-- Divisions and TennisLink Team IDs per Darrin, 2026-08-17. USTA NorCal Fall
-- Travel League, East Bay / Tri-Valley area: matches Sundays 4:00pm,
-- Sep 13 - Nov 1 2026, sectionals Nov 14-15 at Fremont Tennis Center.
--
-- Deliberately creates the TEAMS ONLY. Rosters live on TennisLink (fall
-- players self-register there, not on Captyn and not in ClubMode) and the
-- opponent schedule is not published anywhere this script can read. Inventing
-- either would put availability emails in front of parents for dates and
-- children that may not be real -- the captain pastes his TennisLink team page
-- into the Import panel instead, which fills both.
--
-- Idempotent: keyed on source_team_id, so re-running updates rather than
-- duplicating.
--
-- Run: node scripts/dbrun.mjs scripts/one-off/jtt-fall-2026-teams.sql
-- =====================================================================

INSERT INTO captain_teams (
  captain_user_id, created_by, club_id, name, league_type, level,
  season_start, season_end,
  source_site, source_team_id,
  default_singles_courts, default_doubles_courts,
  -- Juniors play to develop, not to bank a win: everyone gets as close to the
  -- same number of matches as the schedule allows.
  captaining_style,
  -- A weekly Sunday season. The adult default (ask 21 days out, lineup 7)
  -- would have the poll for match 3 going out before match 1 is played.
  poll_lead_days, lineup_lead_days,
  -- JTT sectionals qualification is a team matter, not a per-player match
  -- minimum, so the eligibility tracker stays off.
  eligibility_enabled
)
SELECT
  '7ff5078a-ee6d-46b7-9af7-20b35f62729d'::uuid,
  '7ff5078a-ee6d-46b7-9af7-20b35f62729d'::uuid,
  'c437bf37-1ea2-4dc1-9250-11402f377726'::uuid,
  v.name, 'jtt', v.level,
  DATE '2026-09-13', DATE '2026-11-15',
  'tennislink', v.team_id,
  2, 2,
  'equal_play',
  10, 4,
  false
FROM (VALUES
  ('Sleepy Hollow 10U Green',         '10U Green Ball',          '5083524580'),
  ('Sleepy Hollow 12U Yellow',        '12U Yellow Ball',         '5083524579'),
  ('Sleepy Hollow 14U Intermediate',  '14U Yellow Intermediate', '5083524582')
) AS v(name, level, team_id)
WHERE NOT EXISTS (
  SELECT 1 FROM captain_teams t
   WHERE t.source_team_id = v.team_id
     AND t.captain_user_id = '7ff5078a-ee6d-46b7-9af7-20b35f62729d'::uuid
);

-- Keep a re-run honest: refresh the details on rows that already exist.
UPDATE captain_teams t
   SET name = v.name,
       level = v.level,
       league_type = 'jtt',
       club_id = 'c437bf37-1ea2-4dc1-9250-11402f377726'::uuid,
       season_start = DATE '2026-09-13',
       season_end = DATE '2026-11-15',
       source_site = 'tennislink',
       default_singles_courts = 2,
       default_doubles_courts = 2,
       updated_at = now()
  FROM (VALUES
    ('Sleepy Hollow 10U Green',         '10U Green Ball',          '5083524580'),
    ('Sleepy Hollow 12U Yellow',        '12U Yellow Ball',         '5083524579'),
    ('Sleepy Hollow 14U Intermediate',  '14U Yellow Intermediate', '5083524582')
  ) AS v(name, level, team_id)
 WHERE t.source_team_id = v.team_id
   AND t.captain_user_id = '7ff5078a-ee6d-46b7-9af7-20b35f62729d'::uuid;
