-- ============================================
-- PTL — the format is not settled, so stop pretending it is
-- ============================================
--
-- The proposal's numbers (12 teams, 3 divisions, 9 a roster, 5.0 floor, one
-- singles and one doubles) are a STARTING POINT that NorCal will argue about.
-- Most of them were already rows or columns — roster_size, courts, entry fee,
-- divisions and teams are all data — but three things were baked into code and
-- had to come out:
--
--   rating_floor   the enrolment route hard-refused anything under 5.0. If the
--                  pilot opens at 4.5 to fill the field, that is a deploy.
--   category       men's / women's / mixed / open was not modelled at all,
--                  and "is this a men's league?" is one of the first questions
--                  a section committee asks.
--   lines          one singles + one doubles is the format, but a division
--                  playing two singles is a plausible variant and the meeting
--                  resolver already works off whatever lines exist.
--
-- Everything else a commissioner might change — how many teams, how many
-- divisions, how many rounds, which site, what the prize money is — is added or
-- edited as rows, and now has a screen to do it from.
--
-- Safe to re-run.
-- ============================================

ALTER TABLE ptl_seasons
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'open'
    CHECK (category IN ('open', 'mens', 'womens', 'mixed'));

-- NTRP floor for enrolment. NULL means no floor at all, which is a real
-- option for a first pilot that just needs bodies.
ALTER TABLE ptl_seasons
  ADD COLUMN IF NOT EXISTS rating_floor NUMERIC(2,1) DEFAULT 5.0;

-- How many of each line a meeting is played over. The cascade does not care —
-- it resolves from whatever lines exist — so this is about what gets created
-- when a night is generated.
ALTER TABLE ptl_divisions
  ADD COLUMN IF NOT EXISTS singles_lines INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ptl_divisions
  ADD COLUMN IF NOT EXISTS doubles_lines INTEGER NOT NULL DEFAULT 1;

-- A default venue for the season, so creating nights does not mean retyping a
-- club name fifteen times. Individual nights still override it.
ALTER TABLE ptl_seasons
  ADD COLUMN IF NOT EXISTS default_site_name TEXT;
ALTER TABLE ptl_seasons
  ADD COLUMN IF NOT EXISTS default_site_address TEXT;
