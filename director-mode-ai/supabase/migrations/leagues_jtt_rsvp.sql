-- ============================================
-- JTT self-service match RSVP (replaces the Google Form)
-- ============================================
-- Adds:
--   * league_division_clubs.signup_token  — public per-team signup link
--       (one link per division, e.g. /leagues/join/<token>)
--   * league_team_rosters.player_token     — per-player reservation magic link
--       (parent manages their kid's availability at /leagues/rsvp/<token>)
--   * league_player_availability           — explicit Yes/No per matchup
--       (a "yes" ALSO writes league_matchup_checkins so the existing
--        facilitator + coach lineup tools keep working unchanged)
--   * leagues.rsvp_confirmation_lead_hours — director-set lead time; NULL = off
--   * league_matchup_confirmations         — dedupe the team confirmation email
--
-- Safe to re-run. Apply after leagues_jtt.sql + leagues_jtt_roster_tokens.sql.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---- 1. Public per-team (division+club) signup token ----------------------
ALTER TABLE league_division_clubs
  ADD COLUMN IF NOT EXISTS signup_token TEXT;
UPDATE league_division_clubs
  SET signup_token = replace(uuid_generate_v4()::text, '-', '')
  WHERE signup_token IS NULL;
ALTER TABLE league_division_clubs
  ALTER COLUMN signup_token SET NOT NULL;
DROP INDEX IF EXISTS idx_division_clubs_signup_token;
CREATE UNIQUE INDEX idx_division_clubs_signup_token ON league_division_clubs(signup_token);
ALTER TABLE league_division_clubs
  ALTER COLUMN signup_token SET DEFAULT replace(uuid_generate_v4()::text, '-', '');

-- ---- 2. Per-player reservation magic-link token ---------------------------
ALTER TABLE league_team_rosters
  ADD COLUMN IF NOT EXISTS player_token TEXT;
UPDATE league_team_rosters
  SET player_token = replace(uuid_generate_v4()::text, '-', '')
  WHERE player_token IS NULL;
ALTER TABLE league_team_rosters
  ALTER COLUMN player_token SET NOT NULL;
DROP INDEX IF EXISTS idx_rosters_player_token;
CREATE UNIQUE INDEX idx_rosters_player_token ON league_team_rosters(player_token);
ALTER TABLE league_team_rosters
  ALTER COLUMN player_token SET DEFAULT replace(uuid_generate_v4()::text, '-', '');

-- ---- 3. Explicit Yes/No availability per (player, matchup) -----------------
CREATE TABLE IF NOT EXISTS league_player_availability (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  roster_id UUID NOT NULL REFERENCES league_team_rosters(id) ON DELETE CASCADE,
  matchup_id UUID NOT NULL REFERENCES league_team_matchups(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('yes','no')),
  responded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (roster_id, matchup_id)
);
CREATE INDEX IF NOT EXISTS idx_availability_matchup ON league_player_availability(matchup_id);
CREATE INDEX IF NOT EXISTS idx_availability_roster ON league_player_availability(roster_id);

-- ---- 4. Director-set confirmation lead time (NULL = auto emails OFF) -------
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS rsvp_confirmation_lead_hours INTEGER;

-- ---- 5. Dedupe the per-team confirmation email ----------------------------
CREATE TABLE IF NOT EXISTS league_matchup_confirmations (
  matchup_id UUID NOT NULL REFERENCES league_team_matchups(id) ON DELETE CASCADE,
  club_id UUID NOT NULL REFERENCES league_clubs(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (matchup_id, club_id)
);
