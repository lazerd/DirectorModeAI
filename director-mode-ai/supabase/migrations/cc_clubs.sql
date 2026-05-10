-- ============================================
-- cc_clubs — CourtConnect-side club profiles
-- ============================================
-- The /courtconnect/club page tries to insert into this table but the
-- table was never created in production (stale schema file — only
-- defined in legacy_schema_stale.sql). Run this once to create it.
-- Safe to re-run.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS cc_clubs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  logo_url TEXT,
  cover_image_url TEXT,

  -- Contact
  website TEXT,
  phone TEXT,
  email TEXT,

  -- Location
  address TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,

  -- Sports offered (array of sport keys: tennis, pickleball, padel, ...)
  sports TEXT[] DEFAULT '{tennis}',

  -- Settings
  is_public BOOLEAN DEFAULT true,
  accept_join_requests BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cc_clubs_owner ON cc_clubs(owner_id);
CREATE INDEX IF NOT EXISTS idx_cc_clubs_slug ON cc_clubs(slug);

ALTER TABLE cc_clubs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage own clubs" ON cc_clubs;
CREATE POLICY "Owners manage own clubs" ON cc_clubs
  FOR ALL USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Public can view public clubs" ON cc_clubs;
CREATE POLICY "Public can view public clubs" ON cc_clubs
  FOR SELECT USING (is_public = true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION touch_cc_clubs_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cc_clubs_updated_at ON cc_clubs;
CREATE TRIGGER trg_cc_clubs_updated_at
  BEFORE UPDATE ON cc_clubs
  FOR EACH ROW EXECUTE FUNCTION touch_cc_clubs_updated_at();
