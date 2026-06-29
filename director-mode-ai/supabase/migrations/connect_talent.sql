-- ============================================
-- ClubMode Connect — passive talent <-> club matchmaking
-- ============================================
-- "Tinder for clubs and directors." A director opts in (anonymous until
-- matched) with their dept, current comp, home ZIP, and relocation radius.
-- A club posts an opening (dept, comp, location). When a posted opening
-- beats a candidate's comp floor and is within their radius, a match is
-- created and the club is handed the director's contact info (the director
-- pre-consented by opting in). The candidate is notified in parallel.
--
-- Follows the cc_clubs.sql conventions (uuid_generate_v4 PKs, RLS,
-- DROP POLICY IF EXISTS + CREATE POLICY, touch_*_updated_at trigger).
-- Idempotent / safe to re-run.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- --------------------------------------------
-- connect_candidates — one row per opted-in director (passive seeker)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS connect_candidates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  master_player_id UUID,

  -- Contact — released to a club only on a qualified match.
  full_name TEXT,
  email TEXT,
  phone TEXT,

  -- Public-safe summary shown in the anonymous pool.
  headline TEXT,

  dept TEXT NOT NULL,                  -- 'Tennis/Racquets' | 'Golf' | 'GM'
  years_experience INT,

  current_comp INT NOT NULL,           -- their comp floor (what they make now)
  min_comp INT,                        -- explicit threshold; defaults to current_comp

  home_zip TEXT,
  home_lat DOUBLE PRECISION,
  home_lng DOUBLE PRECISION,
  radius_miles INT DEFAULT 50,         -- how far they'd relocate

  open_to_work BOOLEAN DEFAULT true,
  reveal_mode TEXT DEFAULT 'auto',     -- 'auto' = release contact on match | 'approve' = confirm first

  claimed_ein TEXT,                    -- 990 record they claimed (prefill provenance)

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connect_candidates_profile ON connect_candidates(profile_id);
CREATE INDEX IF NOT EXISTS idx_connect_candidates_dept ON connect_candidates(dept);
CREATE INDEX IF NOT EXISTS idx_connect_candidates_open ON connect_candidates(open_to_work) WHERE open_to_work = true;

ALTER TABLE connect_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Candidates manage own profile" ON connect_candidates;
CREATE POLICY "Candidates manage own profile" ON connect_candidates
  FOR ALL USING (profile_id = auth.uid());
-- No public SELECT: the anonymous pool is served via a service-role API that
-- strips PII. Direct client reads of other people's rows are never allowed.

-- --------------------------------------------
-- connect_openings — one row per club job posting
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS connect_openings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id UUID REFERENCES cc_clubs(id) ON DELETE CASCADE,  -- optional link to a ClubMode club
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  club_name TEXT,
  dept TEXT NOT NULL,                  -- 'Tennis/Racquets' | 'Golf' | 'GM'
  title TEXT,

  comp_min INT,
  comp_max INT NOT NULL,               -- the offer ceiling; match compares against this

  zip TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,

  description TEXT,
  status TEXT DEFAULT 'open',          -- 'open' | 'filled' | 'closed'

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_connect_openings_owner ON connect_openings(owner_id);
CREATE INDEX IF NOT EXISTS idx_connect_openings_status ON connect_openings(status) WHERE status = 'open';

ALTER TABLE connect_openings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage own openings" ON connect_openings;
CREATE POLICY "Owners manage own openings" ON connect_openings
  FOR ALL USING (owner_id = auth.uid());
-- No public SELECT in v1 — candidates don't browse openings; clubs reach out.

-- --------------------------------------------
-- connect_matches — opening <-> candidate edges
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS connect_matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  opening_id UUID NOT NULL REFERENCES connect_openings(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES connect_candidates(id) ON DELETE CASCADE,

  comp_delta INT,                      -- opening.comp_max - candidate.current_comp
  distance_miles DOUBLE PRECISION,
  score DOUBLE PRECISION,              -- ranking (higher = better)

  status TEXT DEFAULT 'revealed',      -- 'pending_candidate' | 'revealed' | 'club_dismissed' | 'candidate_declined'
  club_notified_at TIMESTAMPTZ,
  candidate_notified_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(opening_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_connect_matches_opening ON connect_matches(opening_id);
CREATE INDEX IF NOT EXISTS idx_connect_matches_candidate ON connect_matches(candidate_id);

ALTER TABLE connect_matches ENABLE ROW LEVEL SECURITY;

-- A match is visible to the club that owns the opening and to the candidate it
-- concerns. All writes go through service-role API routes (matcher), so there
-- are no client INSERT/UPDATE policies.
DROP POLICY IF EXISTS "Match visible to club owner" ON connect_matches;
CREATE POLICY "Match visible to club owner" ON connect_matches
  FOR SELECT USING (
    opening_id IN (SELECT id FROM connect_openings WHERE owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "Match visible to candidate" ON connect_matches;
CREATE POLICY "Match visible to candidate" ON connect_matches
  FOR SELECT USING (
    candidate_id IN (SELECT id FROM connect_candidates WHERE profile_id = auth.uid())
  );

-- --------------------------------------------
-- updated_at triggers
-- --------------------------------------------
CREATE OR REPLACE FUNCTION touch_connect_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_connect_candidates_updated_at ON connect_candidates;
CREATE TRIGGER trg_connect_candidates_updated_at
  BEFORE UPDATE ON connect_candidates
  FOR EACH ROW EXECUTE FUNCTION touch_connect_updated_at();

DROP TRIGGER IF EXISTS trg_connect_openings_updated_at ON connect_openings;
CREATE TRIGGER trg_connect_openings_updated_at
  BEFORE UPDATE ON connect_openings
  FOR EACH ROW EXECUTE FUNCTION touch_connect_updated_at();
