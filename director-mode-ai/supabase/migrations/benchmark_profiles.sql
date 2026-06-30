-- ============================================
-- benchmark_profiles — proprietary "total comp" data (the moat)
-- ============================================
-- The 990 only shows base reportable comp. The number people actually
-- negotiate on is the FULL package: bonus, housing, car, club dues, healthcare,
-- retirement, severance. A director claims their public 990 record and adds
-- what's missing. This dataset compounds and can't be scraped from public 990s.
--
-- Follows the cc_clubs.sql conventions. Idempotent / safe to re-run.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS benchmark_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Claimed public record (provenance + base for the "premium over 990" stat).
  claimed_ein TEXT,
  ninety_base INT,                 -- the 990 total reportable comp they claimed

  full_name TEXT,
  club_name TEXT,
  dept TEXT,                       -- 'Tennis/Racquets' | 'Golf' | 'GM'
  state TEXT,
  region TEXT,

  -- Full package (annual cash value unless noted). base defaults to 990 base.
  base_comp INT,
  bonus INT DEFAULT 0,
  housing INT DEFAULT 0,           -- housing or housing allowance
  auto INT DEFAULT 0,              -- car / auto allowance
  dues INT DEFAULT 0,              -- club membership / dues value
  healthcare INT DEFAULT 0,
  retirement INT DEFAULT 0,        -- 401k match / pension value
  other_amount INT DEFAULT 0,
  other_notes TEXT,                -- e.g. "10% of pro shop sales"

  -- Terms (not summed into cash; tracked for benchmarking).
  vacation_weeks INT,
  severance_months INT,

  total_package INT,               -- computed on save (sum of cash components)
  is_public BOOLEAN DEFAULT true,  -- include in anonymous aggregates

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_benchmark_profiles_profile ON benchmark_profiles(profile_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_profiles_dept ON benchmark_profiles(dept);

ALTER TABLE benchmark_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage own comp profile" ON benchmark_profiles;
CREATE POLICY "Owners manage own comp profile" ON benchmark_profiles
  FOR ALL USING (profile_id = auth.uid());
-- No public SELECT: anonymous aggregates are served by a service-role API that
-- only returns PII-stripped medians/counts.

CREATE OR REPLACE FUNCTION touch_benchmark_profiles_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_benchmark_profiles_updated_at ON benchmark_profiles;
CREATE TRIGGER trg_benchmark_profiles_updated_at
  BEFORE UPDATE ON benchmark_profiles
  FOR EACH ROW EXECUTE FUNCTION touch_benchmark_profiles_updated_at();
