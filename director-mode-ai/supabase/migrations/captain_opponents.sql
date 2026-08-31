-- Opposing-captain contacts belong to the OPPONENT, not the match.
--
-- They come off the league site (TopDog lists captain + co-captain with phone
-- and email on every team page) once per season, and then apply to every
-- fixture against that club. Storing them per-match meant retyping the same
-- contact for each of the two or three times you play them.
CREATE TABLE IF NOT EXISTS captain_opponents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id         UUID NOT NULL REFERENCES captain_teams(id) ON DELETE CASCADE,
  -- Matches captain_matches.opponent verbatim; that string is how fixtures
  -- refer to the other club, so it is the join key we already have.
  opponent        TEXT NOT NULL,
  captain_name    TEXT,
  captain_email   TEXT,
  captain_phone   TEXT,
  cocaptain_name  TEXT,
  cocaptain_email TEXT,
  cocaptain_phone TEXT,
  home_club       TEXT,
  club_phone      TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, opponent)
);

CREATE INDEX IF NOT EXISTS idx_captain_opponents_team ON captain_opponents(team_id);
