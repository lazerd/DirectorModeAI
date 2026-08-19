-- PathwayMode: the ClubMode Junior Pathway.
-- Players climb ball colors (red -> orange -> green -> yellow -> hp) by earning
-- stripes on monthly Test Days. Curriculum lives in code
-- (src/lib/pathway/curriculum.ts); the DB stores who is where.
--
-- Auth model mirrors SwimMode: director-owned rows behind RLS
-- (director_id = auth.uid()); families reach their kid's page with a
-- no-login magic token served by an admin-client API route.

CREATE TABLE IF NOT EXISTS pathway_players (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  director_id UUID NOT NULL,
  name TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'red'
    CHECK (level IN ('red','orange','green','yellow','hp')),
  family_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  family_email TEXT,
  -- appears on the current attendance sheet (false = win-back list)
  enrolled BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pathway_players_director ON pathway_players(director_id);
CREATE INDEX IF NOT EXISTS idx_pathway_players_level ON pathway_players(level);

CREATE TABLE IF NOT EXISTS pathway_awards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id UUID NOT NULL REFERENCES pathway_players(id) ON DELETE CASCADE,
  -- "red-1" ... "yellow-5", or "promoted-orange" etc. for level-ups
  stripe_key TEXT NOT NULL,
  awarded_on DATE NOT NULL DEFAULT CURRENT_DATE,
  awarded_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (player_id, stripe_key)
);
CREATE INDEX IF NOT EXISTS idx_pathway_awards_player ON pathway_awards(player_id);

DROP TRIGGER IF EXISTS trg_pathway_players_touch ON pathway_players;
CREATE TRIGGER trg_pathway_players_touch BEFORE UPDATE ON pathway_players
  FOR EACH ROW EXECUTE FUNCTION touch_swim_updated_at();

ALTER TABLE pathway_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE pathway_awards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Director manages own pathway players" ON pathway_players;
CREATE POLICY "Director manages own pathway players" ON pathway_players
  FOR ALL USING (director_id = auth.uid());

DROP POLICY IF EXISTS "Director manages own pathway awards" ON pathway_awards;
CREATE POLICY "Director manages own pathway awards" ON pathway_awards
  FOR ALL USING (
    EXISTS (SELECT 1 FROM pathway_players p WHERE p.id = player_id AND p.director_id = auth.uid())
  );
