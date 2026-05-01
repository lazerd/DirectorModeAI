-- ============================================================================
-- Pending production sync — paste into Supabase SQL editor and run once.
-- ============================================================================
--
-- This file consolidates every migration under ./migrations/ that has NOT
-- yet been applied to the live Supabase database. Every block is wrapped in
-- a DO / IF NOT EXISTS guard so re-running this whole file is completely
-- idempotent — if you've already applied part of it, only the missing
-- pieces will run.
--
-- Current pending migrations:
--   1. leagues_realtime.sql     — adds league_matches + league_flights to
--                                 the supabase_realtime publication so the
--                                 public bracket page at /leagues/[slug]/bracket
--                                 can subscribe to live score updates.
--   2. email_unsubscribes.sql   — creates the email_unsubscribes blocklist
--                                 that the one-click unsubscribe footer
--                                 inserts into when recipients opt out.
--
-- When you add a new migration file in ./migrations/ later, append its
-- contents to this file (still wrapped in guards) and re-run. Think of
-- this file as the "if my local migrations folder is the source of truth,
-- here's the diff I still need to apply to prod".
--
-- How to run:
--   1. Open Supabase dashboard → your project → SQL Editor
--   2. Paste this entire file
--   3. Click Run
--   4. Should complete in a few hundred ms with "Success. No rows returned."
--
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. leagues_realtime.sql — enable Supabase Realtime for league bracket tables
-- ----------------------------------------------------------------------------
-- Without this, the public bracket page (/leagues/[slug]/bracket) loads the
-- initial snapshot fine but never gets live score updates — the
-- postgres_changes subscription on league_matches silently receives nothing
-- because the tables aren't in the publication.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'league_matches'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.league_matches;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'league_flights'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.league_flights;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. email_unsubscribes.sql — one-click unsubscribe blocklist
-- ----------------------------------------------------------------------------
-- Without this, the unsubscribe footer link on every outbound email lands on
-- a page that fails silently because email_unsubscribes doesn't exist yet.
-- The pre-send check in lib/emailUnsubscribe.ts returns false (fail open)
-- on query error so emails still go out in the meantime — the only thing
-- broken before this runs is the opt-out itself.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'email_unsubscribes'
  ) THEN
    CREATE TABLE public.email_unsubscribes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'all',
      unsubscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(email, scope)
    );

    CREATE INDEX idx_email_unsubscribes_email ON public.email_unsubscribes(email);

    -- Service role handles all writes/reads. RLS is enabled but no policies
    -- → anon and authenticated users cannot touch this table directly. The
    -- lib code uses the admin client, so it bypasses RLS.
    ALTER TABLE public.email_unsubscribes ENABLE ROW LEVEL SECURITY;
  END IF;
END $$;

-- ============================================================================
-- 3. quads.sql — Quads tournament tables (public-signup, paid entry, flights
--                of 4, magic-link scoring). Adds public-registration columns
--                to events + Stripe Connect columns to profiles.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- profiles.stripe_account_id — Stripe Connect Express account per director
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_charges_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_payouts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_details_submitted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_account ON profiles(stripe_account_id);

-- events — public-signup tournament extensions
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
  ADD COLUMN IF NOT EXISTS stripe_account_id TEXT,
  ADD COLUMN IF NOT EXISTS public_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (public_status IN ('draft','open','closed','running','completed','cancelled'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_slug ON events(slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_match_format ON events(match_format);
CREATE INDEX IF NOT EXISTS idx_events_public_status ON events(public_status);

-- quad_flights
CREATE TABLE IF NOT EXISTS quad_flights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  tier_label TEXT,
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, sort_order)
);
CREATE INDEX IF NOT EXISTS idx_quad_flights_event ON quad_flights(event_id);

-- quad_entries
CREATE TABLE IF NOT EXISTS quad_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  player_email TEXT,
  player_phone TEXT,
  parent_name TEXT,
  parent_email TEXT,
  parent_phone TEXT,
  date_of_birth DATE,
  gender TEXT CHECK (gender IS NULL OR gender IN ('male','female','nonbinary')),
  ntrp NUMERIC(2,1),
  utr NUMERIC(4,2),
  utr_id TEXT,
  composite_rating NUMERIC(5,2),
  position TEXT NOT NULL DEFAULT 'pending_payment'
    CHECK (position IN ('pending_payment','in_flight','waitlist','withdrawn')),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  flight_id UUID REFERENCES quad_flights(id) ON DELETE SET NULL,
  flight_seed INTEGER CHECK (flight_seed IS NULL OR flight_seed BETWEEN 1 AND 4),
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','paid','waived','refunded','failed')),
  stripe_session_id TEXT,
  stripe_payment_intent_id TEXT,
  amount_paid_cents INTEGER,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quad_entries_event ON quad_entries(event_id);
CREATE INDEX IF NOT EXISTS idx_quad_entries_flight ON quad_entries(flight_id);
CREATE INDEX IF NOT EXISTS idx_quad_entries_position ON quad_entries(event_id, position);
CREATE INDEX IF NOT EXISTS idx_quad_entries_stripe_session ON quad_entries(stripe_session_id);

-- quad_matches
CREATE TABLE IF NOT EXISTS quad_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flight_id UUID NOT NULL REFERENCES quad_flights(id) ON DELETE CASCADE,
  round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 4),
  match_type TEXT NOT NULL CHECK (match_type IN ('singles','doubles')),
  player1_id UUID REFERENCES quad_entries(id) ON DELETE SET NULL,
  player2_id UUID REFERENCES quad_entries(id) ON DELETE SET NULL,
  player3_id UUID REFERENCES quad_entries(id) ON DELETE SET NULL,
  player4_id UUID REFERENCES quad_entries(id) ON DELETE SET NULL,
  court TEXT,
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
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_quad_matches_flight ON quad_matches(flight_id);
CREATE INDEX IF NOT EXISTS idx_quad_matches_round ON quad_matches(flight_id, round);
CREATE INDEX IF NOT EXISTS idx_quad_matches_score_token ON quad_matches(score_token);
CREATE INDEX IF NOT EXISTS idx_quad_matches_status ON quad_matches(status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION touch_quad_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_quad_entries_touch ON quad_entries;
CREATE TRIGGER trg_quad_entries_touch
  BEFORE UPDATE ON quad_entries FOR EACH ROW EXECUTE FUNCTION touch_quad_updated_at();

DROP TRIGGER IF EXISTS trg_quad_matches_touch ON quad_matches;
CREATE TRIGGER trg_quad_matches_touch
  BEFORE UPDATE ON quad_matches FOR EACH ROW EXECUTE FUNCTION touch_quad_updated_at();

-- RLS
ALTER TABLE quad_flights ENABLE ROW LEVEL SECURITY;
ALTER TABLE quad_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE quad_matches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Directors manage quad flights" ON quad_flights;
CREATE POLICY "Directors manage quad flights" ON quad_flights
  FOR ALL USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND e.user_id = auth.uid()));
DROP POLICY IF EXISTS "Public can view quad flights" ON quad_flights;
CREATE POLICY "Public can view quad flights" ON quad_flights
  FOR SELECT USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND e.public_status IN ('open','closed','running','completed')));

DROP POLICY IF EXISTS "Directors manage quad entries" ON quad_entries;
CREATE POLICY "Directors manage quad entries" ON quad_entries
  FOR ALL USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND e.user_id = auth.uid()));
DROP POLICY IF EXISTS "Public can view quad entries" ON quad_entries;
CREATE POLICY "Public can view quad entries" ON quad_entries
  FOR SELECT USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_id AND e.public_status IN ('open','closed','running','completed')));

DROP POLICY IF EXISTS "Directors manage quad matches" ON quad_matches;
CREATE POLICY "Directors manage quad matches" ON quad_matches
  FOR ALL USING (
    EXISTS (SELECT 1 FROM quad_flights f JOIN events e ON e.id = f.event_id
            WHERE f.id = flight_id AND e.user_id = auth.uid())
  );
DROP POLICY IF EXISTS "Public can view quad matches" ON quad_matches;
CREATE POLICY "Public can view quad matches" ON quad_matches
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM quad_flights f JOIN events e ON e.id = f.event_id
            WHERE f.id = flight_id AND e.public_status IN ('running','completed'))
  );

-- ============================================================================
-- 4. quads_player_tokens.sql — per-player scoring URL token. Each
--    quad_entries row gets a unique token so the player can open ONE link
--    and see all their matches. Replaces the old per-match-token UX.
-- ============================================================================

ALTER TABLE quad_entries
  ADD COLUMN IF NOT EXISTS player_token TEXT;

UPDATE quad_entries
SET player_token = replace(uuid_generate_v4()::text, '-', '')
WHERE player_token IS NULL;

ALTER TABLE quad_entries
  ALTER COLUMN player_token SET NOT NULL;

ALTER TABLE quad_entries
  ALTER COLUMN player_token SET DEFAULT replace(uuid_generate_v4()::text, '-', '');

DROP INDEX IF EXISTS idx_quad_entries_player_token;
CREATE UNIQUE INDEX idx_quad_entries_player_token ON quad_entries(player_token);

-- ============================================================================
-- 5. quads_scheduling.sql — per-match start time + per-event round duration.
--    Used by the Auto-schedule button + the per-player schedule emails.
-- ============================================================================

ALTER TABLE quad_matches
  ADD COLUMN IF NOT EXISTS scheduled_at TIME;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS round_duration_minutes INTEGER NOT NULL DEFAULT 45
    CHECK (round_duration_minutes BETWEEN 5 AND 240);

-- ============================================================================
-- End of pending sync. If you see "Success. No rows returned." the database
-- is now aligned with every committed migration in director-mode-ai/supabase/
-- migrations/. Safe to re-run this file any time.
-- ============================================================================
