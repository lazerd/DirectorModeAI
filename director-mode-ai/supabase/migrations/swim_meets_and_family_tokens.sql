-- ============================================
-- SwimMode — meets + per-family magic-link tokens
-- ============================================
-- Adds:
--   swim_meets — one row per meet (e.g. "vs Lamorinda, Jul 15"). A meet
--     has many jobs (timer, concession, set-up, etc.).
--   swim_jobs.meet_id — nullable FK; jobs not tied to a meet still work.
--   swim_families.family_token — 32-hex magic link the lead shares with
--     each family so they can view their points at /swim-family/[token]
--     without logging in.
--
-- Safe to re-run.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS swim_meets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID NOT NULL REFERENCES swim_seasons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  meet_date DATE,
  location TEXT,
  opponent TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_swim_meets_season ON swim_meets(season_id);
CREATE INDEX IF NOT EXISTS idx_swim_meets_date ON swim_meets(meet_date);

ALTER TABLE swim_jobs
  ADD COLUMN IF NOT EXISTS meet_id UUID REFERENCES swim_meets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_swim_jobs_meet ON swim_jobs(meet_id);

-- Per-family magic-link token for the public family-facing page.
ALTER TABLE swim_families
  ADD COLUMN IF NOT EXISTS family_token TEXT;

UPDATE swim_families
SET family_token = replace(uuid_generate_v4()::text, '-', '')
WHERE family_token IS NULL;

ALTER TABLE swim_families
  ALTER COLUMN family_token SET NOT NULL;
ALTER TABLE swim_families
  ALTER COLUMN family_token SET DEFAULT replace(uuid_generate_v4()::text, '-', '');

DROP INDEX IF EXISTS idx_swim_families_token;
CREATE UNIQUE INDEX idx_swim_families_token ON swim_families(family_token);

-- updated_at trigger for swim_meets
DROP TRIGGER IF EXISTS trg_swim_meets_touch ON swim_meets;
CREATE TRIGGER trg_swim_meets_touch
  BEFORE UPDATE ON swim_meets
  FOR EACH ROW EXECUTE FUNCTION touch_swim_updated_at();

-- RLS
ALTER TABLE swim_meets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Director manages own meets" ON swim_meets;
CREATE POLICY "Director manages own meets" ON swim_meets
  FOR ALL USING (
    EXISTS (SELECT 1 FROM swim_seasons s WHERE s.id = season_id AND s.director_id = auth.uid())
  );

-- Public family page reads families/jobs/meets/assignments via service-role
-- API endpoint, so no anon RLS policy needed here.
