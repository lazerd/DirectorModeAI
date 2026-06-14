-- ============================================
-- Master Players Spine (Phase 1)
-- - One canonical Player record per real human (matched by email / phone)
-- - Nullable FK on every existing player-shaped table so nothing breaks
-- - player_events stream for cross-tool activity (powers Board Report)
-- - All additive. No existing RLS or column is touched.
-- ============================================

-- 1) Master players table
CREATE TABLE IF NOT EXISTS master_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT,
  email_normalized TEXT GENERATED ALWAYS AS (LOWER(TRIM(email))) STORED,
  phone TEXT,
  phone_normalized TEXT,
  full_name TEXT,
  dob DATE,
  primary_club_id UUID,
  parent_email TEXT,
  parent_phone TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_master_players_email_norm ON master_players(email_normalized) WHERE email_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_master_players_phone_norm ON master_players(phone_normalized) WHERE phone_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_master_players_name ON master_players(full_name);

-- 2) Nullable master_player_id on every player-shaped table.
-- Each is a separate ALTER so a failure on one table doesn't roll back others.
-- All IF NOT EXISTS, all nullable -- zero risk to JTT.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'players') THEN
    ALTER TABLE players ADD COLUMN IF NOT EXISTS master_player_id UUID REFERENCES master_players(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_players_master_player_id ON players(master_player_id);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tournament_entries') THEN
    ALTER TABLE tournament_entries ADD COLUMN IF NOT EXISTS master_player_id UUID REFERENCES master_players(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_tournament_entries_master_player_id ON tournament_entries(master_player_id);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'quad_entries') THEN
    ALTER TABLE quad_entries ADD COLUMN IF NOT EXISTS master_player_id UUID REFERENCES master_players(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_quad_entries_master_player_id ON quad_entries(master_player_id);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'league_entries') THEN
    ALTER TABLE league_entries ADD COLUMN IF NOT EXISTS master_player_id UUID REFERENCES master_players(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_league_entries_master_player_id ON league_entries(master_player_id);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'league_team_rosters') THEN
    ALTER TABLE league_team_rosters ADD COLUMN IF NOT EXISTS master_player_id UUID REFERENCES master_players(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_league_team_rosters_master_player_id ON league_team_rosters(master_player_id);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cc_players') THEN
    ALTER TABLE cc_players ADD COLUMN IF NOT EXISTS master_player_id UUID REFERENCES master_players(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_cc_players_master_player_id ON cc_players(master_player_id);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cc_vault_players') THEN
    ALTER TABLE cc_vault_players ADD COLUMN IF NOT EXISTS master_player_id UUID REFERENCES master_players(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_cc_vault_players_master_player_id ON cc_vault_players(master_player_id);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'lesson_clients') THEN
    ALTER TABLE lesson_clients ADD COLUMN IF NOT EXISTS master_player_id UUID REFERENCES master_players(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_lesson_clients_master_player_id ON lesson_clients(master_player_id);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stringing_customers') THEN
    ALTER TABLE stringing_customers ADD COLUMN IF NOT EXISTS master_player_id UUID REFERENCES master_players(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_stringing_customers_master_player_id ON stringing_customers(master_player_id);
  END IF;
END $$;

-- 3) Player events stream (the data spine for Board Report)
CREATE TABLE IF NOT EXISTS player_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_player_id UUID NOT NULL REFERENCES master_players(id) ON DELETE CASCADE,
  club_id UUID,
  source TEXT NOT NULL, -- 'mixer' | 'jtt' | 'tournament' | 'lesson' | 'stringing' | 'exam' | 'satisfaction' | 'court' | 'swim'
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_table TEXT, -- e.g. 'league_matchup_lines'
  source_row_id TEXT, -- composite-stringified id from source row, for idempotency
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT player_events_source_row_unique UNIQUE (source_table, source_row_id)
);

CREATE INDEX IF NOT EXISTS idx_player_events_player ON player_events(master_player_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_player_events_club ON player_events(club_id, occurred_at DESC) WHERE club_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_player_events_source_type ON player_events(source, event_type);

-- 4) Sync state (so the cron knows what's been processed without scanning everything)
CREATE TABLE IF NOT EXISTS master_player_sync_state (
  source_table TEXT PRIMARY KEY,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rows_processed INT NOT NULL DEFAULT 0,
  rows_matched INT NOT NULL DEFAULT 0,
  rows_created INT NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5) RLS: service_role only for now. We'll add user-facing read policies later
-- when the Board Report UI ships in Phase 3.

ALTER TABLE master_players ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS master_players_service_role ON master_players;
CREATE POLICY master_players_service_role ON master_players
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

ALTER TABLE player_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS player_events_service_role ON player_events;
CREATE POLICY player_events_service_role ON player_events
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

ALTER TABLE master_player_sync_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS master_player_sync_state_service_role ON master_player_sync_state;
CREATE POLICY master_player_sync_state_service_role ON master_player_sync_state
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 6) updated_at trigger on master_players
CREATE OR REPLACE FUNCTION touch_master_players_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_master_players_updated_at ON master_players;
CREATE TRIGGER trigger_master_players_updated_at
  BEFORE UPDATE ON master_players
  FOR EACH ROW EXECUTE FUNCTION touch_master_players_updated_at();
