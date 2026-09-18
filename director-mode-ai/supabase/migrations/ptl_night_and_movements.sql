-- ============================================
-- PTL — match night, and end-of-season movement
-- ============================================
--
-- NIGHT TOKEN. Whoever is running the night — a host pro, a captain, whoever
-- has the iPad — needs one link that opens the whole evening: six meetings,
-- twelve lines, and the tiebreak prompts when a meeting will not resolve. The
-- per-line score_token already lets a player report their own line; this is the
-- console for the person standing courtside with all of them.
--
-- MOVEMENTS ARE RECORDED, NOT APPLIED. Promotion and relegation happen BETWEEN
-- seasons, and a team belongs to exactly one season, so there is nothing to
-- mutate at the moment the commissioner confirms it — next season's teams do
-- not exist yet. Writing the decision down means the table can say "Crosscourt
-- were relegated" forever, and next season's setup reads these rows to place
-- teams instead of the commissioner re-deriving it from a finished table
-- months later.
--
-- Safe to re-run.
-- ============================================

ALTER TABLE ptl_nights
  ADD COLUMN IF NOT EXISTS night_token TEXT;

-- Backfill before the unique index, or existing rows collide on NULL-free
-- uniqueness later. gen_random_uuid twice = 64 hex chars, same shape as the
-- other tokens in this schema.
UPDATE ptl_nights
   SET night_token = replace(gen_random_uuid()::text, '-', '')
                     || replace(gen_random_uuid()::text, '-', '')
 WHERE night_token IS NULL;

/*
 * A DEFAULT, not just a backfill. The first cut only filled in the rows that
 * existed, which left every night created afterwards with a NULL token — and
 * because a unique index permits many NULLs, nothing complained. The nights
 * simply had no scoring link, discoverable only by trying to open one. Any
 * insert path, including the seed script, now gets a token without asking.
 */
ALTER TABLE ptl_nights
  ALTER COLUMN night_token SET DEFAULT
    replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

UPDATE ptl_nights
   SET night_token = replace(gen_random_uuid()::text, '-', '')
                     || replace(gen_random_uuid()::text, '-', '')
 WHERE night_token IS NULL;

ALTER TABLE ptl_nights ALTER COLUMN night_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ptl_nights_token ON ptl_nights(night_token);

-- ============================================
-- ptl_movements — who went up and who went down
-- ============================================
CREATE TABLE IF NOT EXISTS ptl_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID NOT NULL REFERENCES ptl_seasons(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES ptl_teams(id) ON DELETE CASCADE,

  from_division_id UUID REFERENCES ptl_divisions(id) ON DELETE SET NULL,
  to_division_id UUID REFERENCES ptl_divisions(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('promoted', 'relegated')),

  -- The table the decision was made from, frozen at confirmation time. A
  -- standings page recomputes from live meetings, so without this a later
  -- correction to an old score would silently rewrite the history of why a
  -- team went down.
  final_rank INTEGER,
  final_record TEXT,

  confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_ptl_movements_season ON ptl_movements(season_id);

ALTER TABLE ptl_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ptl_movements FROM anon, authenticated;
