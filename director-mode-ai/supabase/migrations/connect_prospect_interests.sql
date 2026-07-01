-- ============================================
-- ClubMode Recruiting — persistent prospect interests
-- ============================================
-- Prospects come from the PUBLIC 990 data and haven't opted in, so "Request an
-- intro" can't just create a match. Instead we record the club's interest in a
-- named public prospect (identified by their 990 EIN + name). Later, when that
-- director opts into Recruiting and CLAIMS that same 990 record, we surface
-- "N clubs asked to talk to you" and let them accept (which shares their
-- contact with the club). Closes the loop from public prospect -> real match.
--
-- Follows connect_talent.sql conventions. Idempotent / safe to re-run.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS connect_prospect_interests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,   -- the club user
  opening_id UUID REFERENCES connect_openings(id) ON DELETE SET NULL,   -- optional linked opening

  club_name TEXT,
  role TEXT,                            -- dept or title being hired for
  comp_min INT,
  comp_max INT,

  -- The public 990 prospect this interest is in.
  prospect_ein TEXT NOT NULL,
  prospect_name TEXT NOT NULL,
  prospect_name_norm TEXT NOT NULL,     -- lower(trim(name)) — the match key
  prospect_club TEXT,
  prospect_title TEXT,
  prospect_comp INT,
  prospect_year TEXT,
  prospect_url TEXT,

  status TEXT DEFAULT 'open',           -- 'open' | 'connected' | 'dismissed'

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(owner_id, prospect_ein, prospect_name_norm)
);

-- The candidate-side lookup matches on EIN + normalized name.
CREATE INDEX IF NOT EXISTS idx_prospect_interests_match
  ON connect_prospect_interests(prospect_ein, prospect_name_norm);
CREATE INDEX IF NOT EXISTS idx_prospect_interests_owner
  ON connect_prospect_interests(owner_id);

ALTER TABLE connect_prospect_interests ENABLE ROW LEVEL SECURITY;

-- Clubs manage their own interests. The candidate-facing read/accept goes
-- through service-role API routes (scoped to the caller's claimed 990 record),
-- so there is no client-facing candidate policy here.
DROP POLICY IF EXISTS "Owners manage own prospect interests" ON connect_prospect_interests;
CREATE POLICY "Owners manage own prospect interests" ON connect_prospect_interests
  FOR ALL USING (owner_id = auth.uid());

DROP TRIGGER IF EXISTS trg_prospect_interests_updated_at ON connect_prospect_interests;
CREATE TRIGGER trg_prospect_interests_updated_at
  BEFORE UPDATE ON connect_prospect_interests
  FOR EACH ROW EXECUTE FUNCTION touch_connect_updated_at();
