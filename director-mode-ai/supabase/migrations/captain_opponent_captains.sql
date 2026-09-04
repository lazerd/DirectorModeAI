-- =====================================================================
-- The league's captain contact list, and the court format a club hosts on.
--
-- captain_opponents carries exactly two people (captain_* and cocaptain_*),
-- which is what a TopDog adult team page publishes. The USTA junior sections
-- publish something wider: a contact sheet with up to FIVE captains per team,
-- each with their own USTA number and Safe Play expiry. Moraga runs three,
-- Davie Deers four. Squeezing that into two columns loses real people a
-- captain needs to reach on a Sunday morning.
--
-- So the contacts become rows. captain_opponents stays the team-level record
-- (who they are, where they play, what format they host); the people hang off
-- it, ordered as the league listed them.
--
-- Run: node scripts/dbrun.mjs supabase/migrations/captain_opponent_captains.sql
-- Safe to re-run.
-- =====================================================================

CREATE TABLE IF NOT EXISTS captain_opponent_captains (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opponent_id       UUID NOT NULL REFERENCES captain_opponents(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  usta_number       TEXT,
  -- Left as the league wrote it. A captain eyeballs this to see whether the
  -- person opposite is still cleared to be on court with children; parsing it
  -- into a date would invite showing "Invalid Date" for a typo in a sheet we
  -- do not control.
  safe_play_expires TEXT,
  email             TEXT,
  phone             TEXT,
  -- The order the league listed them. The first name is the one to contact.
  sort_order        INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (opponent_id, name)
);
CREATE INDEX IF NOT EXISTS idx_captain_opponent_captains_opponent
  ON captain_opponent_captains(opponent_id);

ALTER TABLE captain_opponents
  -- Which flight this team plays. A club fields one team per division, so the
  -- name alone ("Moraga Country Club") does not identify the opponent.
  ADD COLUMN IF NOT EXISTS division         TEXT,
  -- The league's own id for them, the same idea as captain_teams.source_team_id.
  ADD COLUMN IF NOT EXISTS source_team_id   TEXT,
  -- How many courts they host on. In Junior Team Tennis this decides how the
  -- eight lines are scheduled and therefore how long the afternoon runs, so it
  -- is the first thing the visiting captain asks and the first thing the
  -- confirmation email should answer.
  ADD COLUMN IF NOT EXISTS court_format     INT;

ALTER TABLE captain_teams
  ADD COLUMN IF NOT EXISTS court_format     INT;

ALTER TABLE captain_opponents  DROP CONSTRAINT IF EXISTS captain_opponents_court_format_check;
ALTER TABLE captain_opponents
  ADD CONSTRAINT captain_opponents_court_format_check
  CHECK (court_format IS NULL OR court_format BETWEEN 1 AND 8);
ALTER TABLE captain_teams      DROP CONSTRAINT IF EXISTS captain_teams_court_format_check;
ALTER TABLE captain_teams
  ADD CONSTRAINT captain_teams_court_format_check
  CHECK (court_format IS NULL OR court_format BETWEEN 1 AND 8);

-- Move the two existing contacts onto rows so there is one place to read from.
-- ON CONFLICT DO NOTHING makes the whole migration re-runnable.
INSERT INTO captain_opponent_captains (opponent_id, name, email, phone, sort_order)
SELECT id, captain_name, captain_email, captain_phone, 0
  FROM captain_opponents
 WHERE captain_name IS NOT NULL AND btrim(captain_name) <> ''
ON CONFLICT (opponent_id, name) DO NOTHING;

INSERT INTO captain_opponent_captains (opponent_id, name, email, phone, sort_order)
SELECT id, cocaptain_name, cocaptain_email, cocaptain_phone, 1
  FROM captain_opponents
 WHERE cocaptain_name IS NOT NULL AND btrim(cocaptain_name) <> ''
ON CONFLICT (opponent_id, name) DO NOTHING;

ALTER TABLE captain_opponent_captains ENABLE ROW LEVEL SECURITY;

-- Same boundary as every other captain table: the team's own staff, and nobody
-- else. anon gets no grants at all.
DROP POLICY IF EXISTS captain_opponent_captains_rw ON captain_opponent_captains;
CREATE POLICY captain_opponent_captains_rw ON captain_opponent_captains
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM captain_opponents o
       WHERE o.id = captain_opponent_captains.opponent_id
         AND public.captain_can_access_team(o.team_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM captain_opponents o
       WHERE o.id = captain_opponent_captains.opponent_id
         AND public.captain_can_access_team(o.team_id)
    )
  );
