-- ============================================
-- Generic Tournament tables (RR, Single Elim, FMLC, FFIC)
-- ============================================
-- Quads keeps its own quad_* tables (flight-of-4 structure is unique).
-- Every other tournament format uses these generic tables:
--
--   tournament_entries  — public-signup registrants (any format)
--   tournament_matches  — bracket/round-robin matches with feed-in refs
--
-- The events row gates everything: events.match_format ∈ {
--   'rr-singles','rr-doubles',
--   'single-elim-singles','single-elim-doubles',
--   'fmlc-singles','fmlc-doubles',
--   'ffic-singles','ffic-doubles'
-- }
--
-- Reuses the per-event extensions from quads.sql (slug, public_registration,
-- entry_fee_cents, max_players, age_max, gender_restriction,
-- event_scoring_format, court_names, round_duration_minutes, public_status,
-- stripe_account_id) — no new event columns needed.
--
-- Safe to re-run.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- tournament_entries — registrants
-- ============================================
CREATE TABLE IF NOT EXISTS tournament_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,

  -- Captain / singles player contact
  player_name TEXT NOT NULL,
  player_email TEXT,
  player_phone TEXT,
  parent_name TEXT,
  parent_email TEXT,
  parent_phone TEXT,
  date_of_birth DATE,
  gender TEXT CHECK (gender IS NULL OR gender IN ('male','female','nonbinary')),

  -- Ratings
  ntrp NUMERIC(2,1),
  utr NUMERIC(4,2),
  utr_id TEXT,
  composite_rating NUMERIC(5,2),

  -- Doubles partner (only used when match_format ends in '-doubles')
  partner_name TEXT,
  partner_email TEXT,
  partner_phone TEXT,
  partner_ntrp NUMERIC(2,1),
  partner_utr NUMERIC(4,2),

  -- Registration lifecycle
  position TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (position IN ('pending_payment','in_draw','waitlist','withdrawn')),
  seed INTEGER,                              -- 1-indexed bracket seed; null until draws generated
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Payment
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','paid','waived','refunded','failed')),
  stripe_session_id TEXT,
  stripe_payment_intent_id TEXT,
  amount_paid_cents INTEGER,

  -- Per-player magic-link scoring URL token
  player_token TEXT NOT NULL UNIQUE
    DEFAULT replace(uuid_generate_v4()::text, '-', ''),

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournament_entries_event ON tournament_entries(event_id);
CREATE INDEX IF NOT EXISTS idx_tournament_entries_position ON tournament_entries(event_id, position);
CREATE INDEX IF NOT EXISTS idx_tournament_entries_player_token ON tournament_entries(player_token);
CREATE INDEX IF NOT EXISTS idx_tournament_entries_stripe_session ON tournament_entries(stripe_session_id);

-- ============================================
-- tournament_matches — bracket + round-robin matches
-- ============================================
CREATE TABLE IF NOT EXISTS tournament_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,

  bracket TEXT NOT NULL DEFAULT 'main'
    CHECK (bracket IN ('main','consolation')),
  round INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('singles','doubles')),

  -- Side A: player1 (+ player2 for doubles)
  -- Side B: player3 (+ player4 for doubles)
  player1_id UUID REFERENCES tournament_entries(id) ON DELETE SET NULL,
  player2_id UUID REFERENCES tournament_entries(id) ON DELETE SET NULL,
  player3_id UUID REFERENCES tournament_entries(id) ON DELETE SET NULL,
  player4_id UUID REFERENCES tournament_entries(id) ON DELETE SET NULL,

  -- Bracket advancement references — string format "bracket:round:slot:side"
  -- e.g. "main:2:1:a" means winner of this match becomes side A of (main, R2, slot 1)
  winner_feeds_to TEXT,
  loser_feeds_to TEXT,

  court TEXT,
  scheduled_at TIME,
  score TEXT,
  winner_side TEXT CHECK (winner_side IS NULL OR winner_side IN ('a','b')),

  score_token TEXT NOT NULL UNIQUE
    DEFAULT replace(uuid_generate_v4()::text, '-', ''),

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','completed','defaulted','cancelled')),

  reported_at TIMESTAMPTZ,
  reported_by_token TEXT,
  reported_by_name TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (event_id, bracket, round, slot)
);

CREATE INDEX IF NOT EXISTS idx_tournament_matches_event ON tournament_matches(event_id);
CREATE INDEX IF NOT EXISTS idx_tournament_matches_bracket ON tournament_matches(event_id, bracket, round);
CREATE INDEX IF NOT EXISTS idx_tournament_matches_score_token ON tournament_matches(score_token);
CREATE INDEX IF NOT EXISTS idx_tournament_matches_status ON tournament_matches(status);

-- ============================================
-- updated_at triggers
-- ============================================
CREATE OR REPLACE FUNCTION touch_tournament_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tournament_entries_touch ON tournament_entries;
CREATE TRIGGER trg_tournament_entries_touch
  BEFORE UPDATE ON tournament_entries
  FOR EACH ROW EXECUTE FUNCTION touch_tournament_updated_at();

DROP TRIGGER IF EXISTS trg_tournament_matches_touch ON tournament_matches;
CREATE TRIGGER trg_tournament_matches_touch
  BEFORE UPDATE ON tournament_matches
  FOR EACH ROW EXECUTE FUNCTION touch_tournament_updated_at();

-- ============================================
-- Row-level security
-- ============================================
ALTER TABLE tournament_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Directors manage tournament entries" ON tournament_entries;
CREATE POLICY "Directors manage tournament entries" ON tournament_entries
  FOR ALL USING (
    EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND e.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Public can view tournament entries" ON tournament_entries;
CREATE POLICY "Public can view tournament entries" ON tournament_entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM events e WHERE e.id = event_id
      AND e.public_status IN ('open','closed','running','completed')
    )
  );

DROP POLICY IF EXISTS "Directors manage tournament matches" ON tournament_matches;
CREATE POLICY "Directors manage tournament matches" ON tournament_matches
  FOR ALL USING (
    EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND e.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Public can view tournament matches" ON tournament_matches;
CREATE POLICY "Public can view tournament matches" ON tournament_matches
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM events e WHERE e.id = event_id
      AND e.public_status IN ('running','completed')
    )
  );
