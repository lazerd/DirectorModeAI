-- ============================================
-- Quads tournaments (mixer/events)
-- ============================================
-- A "Quads" tournament is a one-off tournament where entrants are
-- grouped into flights of 4. Each flight plays a 3-round singles
-- round-robin (R1: 1v4 + 2v3, R2: 1v3 + 2v4, R3: 1v2 + 3v4) and
-- then a 4th round doubles match where 1st place + 4th place play
-- 2nd place + 3rd place (positions computed from singles results).
--
-- Public signup with Stripe Connect payment. Director picks scoring
-- format, age cap, gender restriction at creation.
--
-- This builds on the existing `events` table (mixer events) by:
--   - Adding columns to `events` for public signup + payment + filters
--   - Adding three new tables: quad_entries, quad_flights, quad_matches
--
-- Safe to re-run.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- profiles.stripe_account_id — Stripe Connect Express account per director
-- ============================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_details_submitted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_account ON profiles(stripe_account_id);

-- ============================================
-- events — extensions for public-signup tournaments (Quads et al.)
-- ============================================
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS public_registration BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS entry_fee_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS registration_opens_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS registration_closes_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_players INTEGER,
  ADD COLUMN IF NOT EXISTS age_max INTEGER,
  ADD COLUMN IF NOT EXISTS gender_restriction TEXT
    CHECK (gender_restriction IS NULL OR gender_restriction IN ('boys','girls','coed')),
  ADD COLUMN IF NOT EXISTS event_scoring_format TEXT,
  -- Snapshot of the director's Stripe Connect account at tournament creation
  -- (so payment links keep working even if the director later disconnects)
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
  ADD COLUMN IF NOT EXISTS public_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (public_status IN ('draft','open','closed','running','completed','cancelled'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_slug ON events(slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_match_format ON events(match_format);
CREATE INDEX IF NOT EXISTS idx_events_public_status ON events(public_status);

-- ============================================
-- quad_flights — one row per group-of-4 within a Quads tournament
-- ============================================
CREATE TABLE IF NOT EXISTS quad_flights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,

  name TEXT NOT NULL,                       -- 'Flight A', 'Flight B', ...
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- Tier label, e.g. "Top tier", "Mid tier" (cosmetic only)
  tier_label TEXT,

  generated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, sort_order)
);

CREATE INDEX IF NOT EXISTS idx_quad_flights_event ON quad_flights(event_id);

-- ============================================
-- quad_entries — public registrants for a Quads tournament
-- ============================================
CREATE TABLE IF NOT EXISTS quad_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,

  -- Registration contact info
  player_name TEXT NOT NULL,
  player_email TEXT,
  player_phone TEXT,
  parent_name TEXT,
  parent_email TEXT,
  parent_phone TEXT,
  date_of_birth DATE,
  gender TEXT CHECK (gender IS NULL OR gender IN ('male','female','nonbinary')),

  -- Ratings (UTR auto-looked-up at signup, NTRP self-reported)
  ntrp NUMERIC(2,1),
  utr NUMERIC(4,2),
  utr_id TEXT,
  -- Director-overridable seeding number (defaults to UTR > NTRP composite)
  composite_rating NUMERIC(5,2),

  -- Registration status
  position TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (position IN ('pending_payment','in_flight','waitlist','withdrawn')),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Flight assignment (set after director generates flights)
  flight_id UUID REFERENCES quad_flights(id) ON DELETE SET NULL,
  flight_seed INTEGER CHECK (flight_seed IS NULL OR flight_seed BETWEEN 1 AND 4),

  -- Payment
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','paid','waived','refunded','failed')),
  stripe_session_id TEXT,
  stripe_payment_intent_id TEXT,
  amount_paid_cents INTEGER,

  -- Director-only override notes
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quad_entries_event ON quad_entries(event_id);
CREATE INDEX IF NOT EXISTS idx_quad_entries_flight ON quad_entries(flight_id);
CREATE INDEX IF NOT EXISTS idx_quad_entries_position ON quad_entries(event_id, position);
CREATE INDEX IF NOT EXISTS idx_quad_entries_stripe_session ON quad_entries(stripe_session_id);

-- ============================================
-- quad_matches — per-flight matches (3 singles rounds + 1 doubles round)
-- ============================================
CREATE TABLE IF NOT EXISTS quad_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID NOT NULL REFERENCES quad_flights(id) ON DELETE CASCADE,

  round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 4),
  match_type TEXT NOT NULL CHECK (match_type IN ('singles','doubles')),

  -- Side A: player1 (+ player2 for doubles)
  -- Side B: player3 (+ player4 for doubles)
  -- For singles, player2 + player4 are NULL.
  player1_id UUID REFERENCES quad_entries(id) ON DELETE SET NULL,
  player2_id UUID REFERENCES quad_entries(id) ON DELETE SET NULL,
  player3_id UUID REFERENCES quad_entries(id) ON DELETE SET NULL,
  player4_id UUID REFERENCES quad_entries(id) ON DELETE SET NULL,

  court TEXT,
  score TEXT,                               -- "6-3, 6-4" or "8-5" pro set or "27-22" timed
  winner_side TEXT CHECK (winner_side IS NULL OR winner_side IN ('a','b')),

  -- Magic-link scoring credential
  score_token TEXT NOT NULL UNIQUE
    DEFAULT replace(uuid_generate_v4()::text, '-', ''),

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','completed','defaulted','cancelled')),

  reported_at TIMESTAMPTZ,
  reported_by_token TEXT,
  reported_by_name TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quad_matches_flight ON quad_matches(flight_id);
CREATE INDEX IF NOT EXISTS idx_quad_matches_round ON quad_matches(flight_id, round);
CREATE INDEX IF NOT EXISTS idx_quad_matches_score_token ON quad_matches(score_token);
CREATE INDEX IF NOT EXISTS idx_quad_matches_status ON quad_matches(status);

-- ============================================
-- updated_at triggers
-- ============================================
CREATE OR REPLACE FUNCTION touch_quad_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quad_entries_touch ON quad_entries;
CREATE TRIGGER trg_quad_entries_touch
  BEFORE UPDATE ON quad_entries
  FOR EACH ROW EXECUTE FUNCTION touch_quad_updated_at();

DROP TRIGGER IF EXISTS trg_quad_matches_touch ON quad_matches;
CREATE TRIGGER trg_quad_matches_touch
  BEFORE UPDATE ON quad_matches
  FOR EACH ROW EXECUTE FUNCTION touch_quad_updated_at();

-- ============================================
-- Row-level security
-- ============================================
ALTER TABLE quad_flights ENABLE ROW LEVEL SECURITY;
ALTER TABLE quad_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE quad_matches ENABLE ROW LEVEL SECURITY;

-- quad_flights: directors manage their event's flights; public reads when running/completed
DROP POLICY IF EXISTS "Directors manage quad flights" ON quad_flights;
CREATE POLICY "Directors manage quad flights" ON quad_flights
  FOR ALL USING (
    EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND e.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Public can view quad flights" ON quad_flights;
CREATE POLICY "Public can view quad flights" ON quad_flights
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM events e WHERE e.id = event_id
      AND e.public_status IN ('open','closed','running','completed')
    )
  );

-- quad_entries: directors manage all; public can SELECT on published events
-- (so signup page can show "X spots left"); insert is via service role only
-- (the public registration endpoint).
DROP POLICY IF EXISTS "Directors manage quad entries" ON quad_entries;
CREATE POLICY "Directors manage quad entries" ON quad_entries
  FOR ALL USING (
    EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND e.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Public can view quad entries" ON quad_entries;
CREATE POLICY "Public can view quad entries" ON quad_entries
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM events e WHERE e.id = event_id
      AND e.public_status IN ('open','closed','running','completed')
    )
  );

-- quad_matches: directors manage; public reads when running/completed
DROP POLICY IF EXISTS "Directors manage quad matches" ON quad_matches;
CREATE POLICY "Directors manage quad matches" ON quad_matches
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM quad_flights f
      JOIN events e ON e.id = f.event_id
      WHERE f.id = flight_id AND e.user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Public can view quad matches" ON quad_matches;
CREATE POLICY "Public can view quad matches" ON quad_matches
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM quad_flights f
      JOIN events e ON e.id = f.event_id
      WHERE f.id = flight_id AND e.public_status IN ('running','completed')
    )
  );
