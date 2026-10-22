-- =====================================================================
-- Rain-out makeup polls.
--
-- A match gets rained out and the other club offers two (or so) makeup dates.
-- The captain asks the players who were IN the lineup first — they have the
-- first claim on the rescheduled match — with Yes / No on every option. Once
-- they've answered, the same poll goes to the rest of the roster.
--
-- One poll per match. `options` is an array of {at} ISO timestamps so the
-- player page and the captain's tally read the same list; votes reference an
-- option by its index into that array.
--
-- Read and written only through the admin client (API routes re-check team
-- ownership / the player token first), so RLS is on with no policies.
--
-- Run: node scripts/dbrun.mjs supabase/migrations/captain_makeup_polls.sql
-- Safe to re-run.
-- =====================================================================

CREATE TABLE IF NOT EXISTS captain_makeup_polls (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id            uuid NOT NULL REFERENCES captain_teams(id) ON DELETE CASCADE,
  match_id           uuid NOT NULL REFERENCES captain_matches(id) ON DELETE CASCADE,
  options            jsonb NOT NULL DEFAULT '[]'::jsonb,
  note               text,
  lineup_sent_at     timestamptz,
  rest_sent_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id)
);

CREATE TABLE IF NOT EXISTS captain_makeup_votes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id       uuid NOT NULL REFERENCES captain_makeup_polls(id) ON DELETE CASCADE,
  player_id     uuid NOT NULL REFERENCES captain_players(id) ON DELETE CASCADE,
  option_index  integer NOT NULL,
  answer        text NOT NULL CHECK (answer IN ('yes','no')),
  responded_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_id, player_id, option_index)
);

CREATE INDEX IF NOT EXISTS captain_makeup_votes_poll_idx ON captain_makeup_votes(poll_id);

ALTER TABLE captain_makeup_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE captain_makeup_votes ENABLE ROW LEVEL SECURITY;
