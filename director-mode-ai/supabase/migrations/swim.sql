-- ============================================
-- SwimMode — volunteer points tracker for swim teams
-- ============================================
-- A swim team lead creates a SEASON, defines JOBS with point values,
-- adds FAMILIES (manually or via CSV), and tracks ASSIGNMENTS as
-- families volunteer for jobs over the season.
--
-- Each family has a season-wide points target (overridable from the
-- season default — e.g., a multi-swimmer family might owe more).
--
-- Tables:
--   swim_seasons      — one row per season (e.g., "Summer 2026")
--   swim_jobs         — catalog of available jobs + point values
--   swim_families     — families participating + their target
--   swim_assignments  — who did what + earned points
--
-- Safe to re-run.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS swim_seasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  director_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  default_points_required INTEGER NOT NULL DEFAULT 20
    CHECK (default_points_required BETWEEN 0 AND 1000),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_swim_seasons_director ON swim_seasons(director_id);

CREATE TABLE IF NOT EXISTS swim_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID NOT NULL REFERENCES swim_seasons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  points INTEGER NOT NULL DEFAULT 1
    CHECK (points BETWEEN 0 AND 100),
  job_date DATE,
  slots INTEGER CHECK (slots IS NULL OR slots > 0),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_swim_jobs_season ON swim_jobs(season_id);
CREATE INDEX IF NOT EXISTS idx_swim_jobs_date ON swim_jobs(job_date);

CREATE TABLE IF NOT EXISTS swim_families (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID NOT NULL REFERENCES swim_seasons(id) ON DELETE CASCADE,
  family_name TEXT NOT NULL,
  primary_email TEXT,
  primary_phone TEXT,
  num_swimmers INTEGER CHECK (num_swimmers IS NULL OR num_swimmers BETWEEN 1 AND 20),
  points_required INTEGER CHECK (points_required IS NULL OR (points_required BETWEEN 0 AND 1000)),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_swim_families_season ON swim_families(season_id);

CREATE TABLE IF NOT EXISTS swim_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id UUID NOT NULL REFERENCES swim_families(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES swim_jobs(id) ON DELETE CASCADE,
  -- Snapshot the awarded points so editing job.points later doesn't
  -- retroactively rewrite history.
  points_awarded INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('signed_up', 'completed', 'no_show', 'cancelled')),
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_swim_assignments_family ON swim_assignments(family_id);
CREATE INDEX IF NOT EXISTS idx_swim_assignments_job ON swim_assignments(job_id);
CREATE INDEX IF NOT EXISTS idx_swim_assignments_status ON swim_assignments(status);

-- updated_at touch trigger (reuse a single function for all swim_* tables)
CREATE OR REPLACE FUNCTION touch_swim_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['swim_seasons','swim_jobs','swim_families','swim_assignments'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_touch ON %s', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_touch BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION touch_swim_updated_at()', t, t);
  END LOOP;
END $$;

-- RLS — each director only sees their own seasons + descendants
ALTER TABLE swim_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE swim_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE swim_families ENABLE ROW LEVEL SECURITY;
ALTER TABLE swim_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Director manages own seasons" ON swim_seasons;
CREATE POLICY "Director manages own seasons" ON swim_seasons
  FOR ALL USING (director_id = auth.uid());

DROP POLICY IF EXISTS "Director manages own jobs" ON swim_jobs;
CREATE POLICY "Director manages own jobs" ON swim_jobs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM swim_seasons s WHERE s.id = season_id AND s.director_id = auth.uid())
  );

DROP POLICY IF EXISTS "Director manages own families" ON swim_families;
CREATE POLICY "Director manages own families" ON swim_families
  FOR ALL USING (
    EXISTS (SELECT 1 FROM swim_seasons s WHERE s.id = season_id AND s.director_id = auth.uid())
  );

DROP POLICY IF EXISTS "Director manages own assignments" ON swim_assignments;
CREATE POLICY "Director manages own assignments" ON swim_assignments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM swim_families f
      JOIN swim_seasons s ON s.id = f.season_id
      WHERE f.id = family_id AND s.director_id = auth.uid()
    )
  );
