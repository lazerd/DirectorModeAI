-- Notes from the club hosting an away match.
--
-- "We look forward to hosting you Tuesday 9/22 at Crow Canyon. Warmup courts at
-- 9, all four lines at 9:30, check in at the front desk, free parking…" — the
-- details a player needs, arriving in the captain's inbox. A captain pastes the
-- email into the match, or forwards it to the team's own address
-- (captain_teams.inbound_token), and the extracted details wait here as a
-- SUGGESTION until the captain applies them to the match. Applying is what puts
-- them into the lineup email, calendar invite and reminder.
--
-- Run: node scripts/dbrun.mjs supabase/migrations/captain_host_notes.sql
-- Safe to re-run.
CREATE TABLE IF NOT EXISTS captain_host_notes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          uuid NOT NULL REFERENCES captain_teams(id) ON DELETE CASCADE,
  -- Null when a forwarded email couldn't be matched to one fixture; the team
  -- hub asks the captain which match it is about.
  match_id         uuid REFERENCES captain_matches(id) ON DELETE SET NULL,
  source           text NOT NULL CHECK (source IN ('paste', 'email')),
  from_email       text,
  subject          text,
  body             text NOT NULL,
  extracted        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'dismissed')),
  -- Resend's id for a forwarded email, so a retried webhook can't file it twice.
  resend_email_id  text UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_captain_host_notes_team ON captain_host_notes(team_id, status);

ALTER TABLE captain_host_notes ENABLE ROW LEVEL SECURITY;
-- No policies: read and written only through the captain API with the service
-- client, after requireTeam() has checked the caller.

-- The local part of the team's forwarding address, e.g. fall-b2b3-7k2m9q.
ALTER TABLE captain_teams
  ADD COLUMN IF NOT EXISTS inbound_token text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_captain_teams_inbound_token
  ON captain_teams(inbound_token) WHERE inbound_token IS NOT NULL;

-- When the lineup had already gone out and the captain sent the players the
-- host's details as an update.
ALTER TABLE captain_matches
  ADD COLUMN IF NOT EXISTS host_update_sent_at timestamptz;
