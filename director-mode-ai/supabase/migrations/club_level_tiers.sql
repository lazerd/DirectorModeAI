-- ============================================
-- cc_club_level_tiers — the names a club gives its levels.
-- ============================================
-- A tennis club rates people 3.0, 3.5, 4.0 and everyone knows what that means.
-- A pickleball club does not: Rossmoor Pickleball's members are Novice,
-- Intermediate, Advanced Intermediate and Advanced, published on their own
-- site, and moving up means being evaluated by their Training Committee.
--
-- So the NAMES are rows, not code. lib/levels.ts carries a sensible default set
-- per sport; a club that has its own names overrides them here, and its seed
-- script is where those facts live (scripts/seed-rossmoor-pickleball.mjs).
--
-- THE NUMBER IS STILL THE STORAGE. master_players.ntrp and
-- cc_vault_players.usta_rating are unchanged, and CourtConnect still matches on
-- numbers. A tier is a name for a band of them:
--
--   rating      what gets stored when a member picks this tier. ONE DECIMAL
--               PLACE: master_players.ntrp, cc_vault_players.usta_rating and
--               pf_games.rating_min/max are all numeric(2,1), so a 2.75 here
--               comes back 2.8 and stops matching the tier it came from.
--   min_rating  the lowest number that READS as this tier; the tier above
--               starts where this one ends, so the bands never have a gap a
--               member's rating could fall into
--   max_rating  the top of the band the club PUBLISHES, shown as the quiet
--               number beside the name. NULL reads "and up".
--
-- Additive and safe to re-run.
-- ============================================

CREATE TABLE IF NOT EXISTS cc_club_level_tiers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id     UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  -- One club can name its pickleball levels and leave tennis on NTRP.
  sport       TEXT NOT NULL,
  -- Low to high. Also what makes a re-run an update rather than a duplicate.
  position    INT  NOT NULL,
  name        TEXT NOT NULL,
  rating      NUMERIC NOT NULL,
  min_rating  NUMERIC NOT NULL,
  max_rating  NUMERIC,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (club_id, sport, position)
);

CREATE INDEX IF NOT EXISTS cc_club_level_tiers_club_sport_idx
  ON cc_club_level_tiers (club_id, sport, position);

-- --------------------------------------------
-- RLS
-- --------------------------------------------
-- Staff manage, via is_club_team() — owner/director/coach/front_desk, never
-- role=member. Everyone may READ the tiers of a public club: these are level
-- names the club already publishes on its own website, they carry nothing
-- about a person, and the club site renders them to signed-out visitors.

ALTER TABLE cc_club_level_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cc_club_level_tiers_staff_all ON cc_club_level_tiers;
CREATE POLICY cc_club_level_tiers_staff_all ON cc_club_level_tiers
  FOR ALL USING (is_club_team(club_id));

DROP POLICY IF EXISTS cc_club_level_tiers_owner_all ON cc_club_level_tiers;
CREATE POLICY cc_club_level_tiers_owner_all ON cc_club_level_tiers
  FOR ALL USING (
    EXISTS (SELECT 1 FROM cc_clubs c WHERE c.id = cc_club_level_tiers.club_id AND c.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS cc_club_level_tiers_public_read ON cc_club_level_tiers;
CREATE POLICY cc_club_level_tiers_public_read ON cc_club_level_tiers
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM cc_clubs c WHERE c.id = cc_club_level_tiers.club_id AND c.is_public)
  );
