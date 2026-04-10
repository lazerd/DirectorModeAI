-- ============================================
-- Summer Compass Draw Leagues
-- ============================================
-- Adds league accept-entries + compass draw infrastructure to the
-- club.coachmode.ai database. Run against the prod DB once to create
-- the five new tables, policies, and indexes.
--
-- Safe to re-run: every CREATE uses IF NOT EXISTS and every INDEX is
-- idempotent. The RLS policies drop-and-recreate.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- leagues — one row per league (e.g. "Lamorinda Summer 2026")
-- ============================================
CREATE TABLE IF NOT EXISTS leagues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  director_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,

  start_date DATE NOT NULL,
  end_date DATE NOT NULL,

  -- Registration window (admin-controlled)
  registration_opens_at TIMESTAMPTZ DEFAULT NOW(),
  registration_closes_at TIMESTAMPTZ,

  -- Lifecycle:
  --   draft      — still being created, not visible publicly
  --   open       — accepting entries
  --   closed     — registration ended, draws not generated yet
  --   running    — draws generated, matches in progress
  --   completed  — all matches done
  --   cancelled  — director cancelled the whole league
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft','open','closed','running','completed','cancelled')
  ),

  -- Off-site payment rails (any or all can be blank for a free league)
  venmo_handle TEXT,
  zelle_handle TEXT,
  stripe_payment_link TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leagues_director ON leagues(director_id);
CREATE INDEX IF NOT EXISTS idx_leagues_status ON leagues(status);
CREATE INDEX IF NOT EXISTS idx_leagues_slug ON leagues(slug);

-- ============================================
-- league_categories — 4 rows per league, one per division
-- ============================================
CREATE TABLE IF NOT EXISTS league_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,

  category_key TEXT NOT NULL CHECK (
    category_key IN ('men_singles','men_doubles','women_singles','women_doubles')
  ),
  entry_fee_cents INTEGER NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, category_key)
);

CREATE INDEX IF NOT EXISTS idx_league_categories_league ON league_categories(league_id);

-- ============================================
-- league_entries — one per singles player, one per doubles pair
-- ============================================
CREATE TABLE IF NOT EXISTS league_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES league_categories(id) ON DELETE CASCADE,

  -- Captain (or the singles player)
  captain_name TEXT NOT NULL,
  captain_email TEXT NOT NULL,
  captain_phone TEXT,
  captain_ntrp NUMERIC(2,1),                                          -- self-reported
  captain_utr NUMERIC(4,2),                                           -- auto-fetched
  captain_utr_id TEXT,                                                -- UTR profileId for linking
  captain_wtn NUMERIC(4,2),                                           -- optional self-reported
  captain_token TEXT NOT NULL UNIQUE DEFAULT replace(uuid_generate_v4()::text, '-', ''),

  -- Doubles partner (nullable for singles entries)
  partner_name TEXT,
  partner_email TEXT,
  partner_phone TEXT,
  partner_ntrp NUMERIC(2,1),
  partner_utr NUMERIC(4,2),
  partner_utr_id TEXT,
  partner_wtn NUMERIC(4,2),
  partner_confirmed_at TIMESTAMPTZ,
  partner_token TEXT UNIQUE,

  -- Computed composite rating (filled when draws generate, or earlier)
  composite_score NUMERIC(5,2),
  rating_source TEXT,                                                 -- 'utr','wtn','ntrp','utr+ntrp', etc
  rating_confidence TEXT CHECK (rating_confidence IN ('high','medium','low')),

  -- Payment
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (
    payment_status IN ('pending','paid','refund_pending','refunded','waived')
  ),

  -- Placement (set when flights are generated)
  flight_id UUID,                                                      -- FK added below
  seed_in_flight INTEGER,                                              -- 1-16 within a flight

  -- Entry lifecycle:
  --   pending_confirm   — doubles awaiting partner email confirmation
  --   active            — confirmed, in the entry list
  --   waitlisted        — didn't make the cut when flights generated
  --   withdrawn         — player pulled out
  entry_status TEXT NOT NULL DEFAULT 'active' CHECK (
    entry_status IN ('pending_confirm','active','waitlisted','withdrawn')
  ),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_league_entries_league ON league_entries(league_id);
CREATE INDEX IF NOT EXISTS idx_league_entries_category ON league_entries(category_id);
CREATE INDEX IF NOT EXISTS idx_league_entries_flight ON league_entries(flight_id);
CREATE INDEX IF NOT EXISTS idx_league_entries_captain_token ON league_entries(captain_token);
CREATE INDEX IF NOT EXISTS idx_league_entries_partner_token ON league_entries(partner_token);
CREATE INDEX IF NOT EXISTS idx_league_entries_status ON league_entries(entry_status);

-- ============================================
-- league_flights — one row per compass draw (16 or 8 players)
-- ============================================
CREATE TABLE IF NOT EXISTS league_flights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES league_categories(id) ON DELETE CASCADE,

  flight_name TEXT NOT NULL,                                          -- 'A', 'B', 'C'...
  size INTEGER NOT NULL CHECK (size IN (8, 16)),
  num_rounds INTEGER NOT NULL CHECK (num_rounds IN (3, 4)),

  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending','running','completed')
  ),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(category_id, flight_name)
);

-- Deferred FK from entries to flights (flights is now created)
ALTER TABLE league_entries
  DROP CONSTRAINT IF EXISTS league_entries_flight_id_fkey,
  ADD CONSTRAINT league_entries_flight_id_fkey
    FOREIGN KEY (flight_id) REFERENCES league_flights(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_league_flights_league ON league_flights(league_id);
CREATE INDEX IF NOT EXISTS idx_league_flights_category ON league_flights(category_id);

-- ============================================
-- league_matches — one row per scheduled match
-- ============================================
CREATE TABLE IF NOT EXISTS league_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID NOT NULL REFERENCES league_flights(id) ON DELETE CASCADE,

  round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 4),
  match_index INTEGER NOT NULL,                                        -- order within round

  -- Compass bracket position:
  --   E1-E8  (R1)
  --   NE, SE, NW, SW  (R2+)
  bracket_position TEXT,

  -- Two entries (singles) or two team entries (doubles) — FK to league_entries
  entry_a_id UUID REFERENCES league_entries(id) ON DELETE SET NULL,
  entry_b_id UUID REFERENCES league_entries(id) ON DELETE SET NULL,

  deadline DATE,
  score TEXT,                                                          -- "6-3, 6-4" or "6-3, 4-6, 7-6(5)"
  winner_entry_id UUID REFERENCES league_entries(id) ON DELETE SET NULL,

  -- Score reporting audit trail
  reported_at TIMESTAMPTZ,
  reported_by_token TEXT,
  disputed_at TIMESTAMPTZ,
  disputed_by_token TEXT,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending','reported','disputed','confirmed','cancelled')
  ),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(flight_id, round, match_index)
);

CREATE INDEX IF NOT EXISTS idx_league_matches_flight ON league_matches(flight_id);
CREATE INDEX IF NOT EXISTS idx_league_matches_round ON league_matches(flight_id, round);
CREATE INDEX IF NOT EXISTS idx_league_matches_status ON league_matches(status);

-- ============================================
-- Row-level security
-- ============================================
ALTER TABLE leagues             ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_flights      ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_matches      ENABLE ROW LEVEL SECURITY;

-- Directors manage their own leagues.
DROP POLICY IF EXISTS "Directors manage own leagues" ON leagues;
CREATE POLICY "Directors manage own leagues" ON leagues
  FOR ALL USING (director_id = auth.uid());

-- Public can read leagues that are open/closed/running/completed (for signup pages).
DROP POLICY IF EXISTS "Public can view published leagues" ON leagues;
CREATE POLICY "Public can view published leagues" ON leagues
  FOR SELECT USING (status IN ('open','closed','running','completed'));

-- Categories / flights / matches: readable by anyone who can read the parent league.
DROP POLICY IF EXISTS "Public can view league categories" ON league_categories;
CREATE POLICY "Public can view league categories" ON league_categories
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM leagues l WHERE l.id = league_id
            AND (l.director_id = auth.uid() OR l.status IN ('open','closed','running','completed')))
  );
DROP POLICY IF EXISTS "Directors manage league categories" ON league_categories;
CREATE POLICY "Directors manage league categories" ON league_categories
  FOR ALL USING (
    EXISTS (SELECT 1 FROM leagues l WHERE l.id = league_id AND l.director_id = auth.uid())
  );

DROP POLICY IF EXISTS "Public can view flights" ON league_flights;
CREATE POLICY "Public can view flights" ON league_flights
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM leagues l WHERE l.id = league_id
            AND l.status IN ('running','completed'))
  );
DROP POLICY IF EXISTS "Directors manage flights" ON league_flights;
CREATE POLICY "Directors manage flights" ON league_flights
  FOR ALL USING (
    EXISTS (SELECT 1 FROM leagues l WHERE l.id = league_id AND l.director_id = auth.uid())
  );

DROP POLICY IF EXISTS "Public can view matches" ON league_matches;
CREATE POLICY "Public can view matches" ON league_matches
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM league_flights f
      JOIN leagues l ON l.id = f.league_id
      WHERE f.id = flight_id AND l.status IN ('running','completed')
    )
  );
DROP POLICY IF EXISTS "Directors manage matches" ON league_matches;
CREATE POLICY "Directors manage matches" ON league_matches
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM league_flights f
      JOIN leagues l ON l.id = f.league_id
      WHERE f.id = flight_id AND l.director_id = auth.uid()
    )
  );

-- Entries policy: directors read everything for their leagues.
-- Public entry submission happens via the service-role API route, not client-side.
DROP POLICY IF EXISTS "Directors read own league entries" ON league_entries;
CREATE POLICY "Directors read own league entries" ON league_entries
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM leagues l WHERE l.id = league_id AND l.director_id = auth.uid())
  );
DROP POLICY IF EXISTS "Directors update own league entries" ON league_entries;
CREATE POLICY "Directors update own league entries" ON league_entries
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM leagues l WHERE l.id = league_id AND l.director_id = auth.uid())
  );

-- updated_at triggers
CREATE OR REPLACE FUNCTION touch_leagues_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_leagues_updated_at ON leagues;
CREATE TRIGGER trg_leagues_updated_at
  BEFORE UPDATE ON leagues
  FOR EACH ROW EXECUTE FUNCTION touch_leagues_updated_at();

DROP TRIGGER IF EXISTS trg_league_entries_updated_at ON league_entries;
CREATE TRIGGER trg_league_entries_updated_at
  BEFORE UPDATE ON league_entries
  FOR EACH ROW EXECUTE FUNCTION touch_leagues_updated_at();

DROP TRIGGER IF EXISTS trg_league_matches_updated_at ON league_matches;
CREATE TRIGGER trg_league_matches_updated_at
  BEFORE UPDATE ON league_matches
  FOR EACH ROW EXECUTE FUNCTION touch_leagues_updated_at();
