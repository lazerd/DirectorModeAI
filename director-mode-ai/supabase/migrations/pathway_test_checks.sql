-- Per-TEST progress inside a stripe. A stripe has three pass/fail tests; a kid
-- who clears two of three on Test Day keeps them and retests only the third
-- next month. When all three are checked the stripe itself is awarded
-- (pathway_awards row), which remains the source of truth for position.

CREATE TABLE IF NOT EXISTS pathway_test_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  player_id UUID NOT NULL REFERENCES pathway_players(id) ON DELETE CASCADE,
  stripe_key TEXT NOT NULL,          -- "red-1" ... "yellow-5"
  test_index INTEGER NOT NULL CHECK (test_index BETWEEN 0 AND 2),
  passed_on DATE NOT NULL DEFAULT CURRENT_DATE,
  passed_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (player_id, stripe_key, test_index)
);
CREATE INDEX IF NOT EXISTS idx_pathway_test_checks_player ON pathway_test_checks(player_id);

ALTER TABLE pathway_test_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Director manages own pathway test checks" ON pathway_test_checks;
CREATE POLICY "Director manages own pathway test checks" ON pathway_test_checks
  FOR ALL USING (
    EXISTS (SELECT 1 FROM pathway_players p WHERE p.id = player_id AND p.director_id = auth.uid())
  );
