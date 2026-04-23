-- ============================================
-- JTT (Junior Team Tennis) — team-format leagues
-- ============================================
-- Adds a "team" format to the existing leagues module. Individual-format
-- leagues (compass/round_robin/single_elimination) are unchanged.
--
-- Team-format leagues use:
--   league_clubs             — the clubs competing (e.g. OCC, MCC, SH…)
--   league_divisions         — divisions with a day-of-week + time window
--   league_division_clubs    — which clubs participate in which division
--                               (Meadow only plays in 10&U, etc.)
--   league_team_rosters      — players on each club's team, per division
--   league_team_matchups     — one row per weekly "Club A vs Club B" fixture
--   league_matchup_lines     — the singles + doubles "lines" within a
--                               matchup, each with its own score
--
-- Safe to re-run. Assumes leagues.sql + leagues_v2.sql already applied.
-- ============================================

-- Add a `format` column to the existing leagues table. Defaults to
-- 'individual' so existing rows don't change behaviour.
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS format TEXT NOT NULL DEFAULT 'individual'
  CHECK (format IN ('individual','team'));

CREATE INDEX IF NOT EXISTS idx_leagues_format ON leagues(format);

-- ============================================
-- league_clubs — clubs participating in a team-format league
-- ============================================
CREATE TABLE IF NOT EXISTS league_clubs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  short_code TEXT NOT NULL,                 -- 'SH', 'OCC', 'MCC', 'RAN', 'MDW'
  color TEXT,                               -- optional hex for standings UI
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,

  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, short_code)
);

CREATE INDEX IF NOT EXISTS idx_league_clubs_league ON league_clubs(league_id);

-- ============================================
-- league_divisions — divisions within a team-format league
-- (replaces league_categories for team mode)
-- ============================================
CREATE TABLE IF NOT EXISTS league_divisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,

  name TEXT NOT NULL,                       -- '10&U', '12&U', '13&O', 'Open'
  short_code TEXT NOT NULL,                 -- '10U', '12U', '13O', 'OPEN'

  -- Schedule template: which weekday + what time slot
  day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun, 2=Tue, 4=Thu
  start_time TIME,
  end_time TIME,

  -- Match format: what lines are played in every matchup
  -- singles_and_doubles = 1 singles + 1 doubles (the Lamorinda default)
  -- singles_only        = 1 singles
  -- doubles_only        = 1 doubles
  -- custom              = lines defined per matchup (advanced)
  line_format TEXT NOT NULL DEFAULT 'singles_and_doubles' CHECK (
    line_format IN ('singles_and_doubles','singles_only','doubles_only','custom')
  ),

  sort_order INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(league_id, short_code)
);

CREATE INDEX IF NOT EXISTS idx_league_divisions_league ON league_divisions(league_id);

-- ============================================
-- league_division_clubs — which clubs play in which division
-- (Meadow only plays 10&U in Lamorinda, etc.)
-- ============================================
CREATE TABLE IF NOT EXISTS league_division_clubs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  division_id UUID NOT NULL REFERENCES league_divisions(id) ON DELETE CASCADE,
  club_id UUID NOT NULL REFERENCES league_clubs(id) ON DELETE CASCADE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(division_id, club_id)
);

CREATE INDEX IF NOT EXISTS idx_league_division_clubs_division ON league_division_clubs(division_id);
CREATE INDEX IF NOT EXISTS idx_league_division_clubs_club ON league_division_clubs(club_id);

-- ============================================
-- league_team_rosters — players on each club's team in each division
-- ============================================
CREATE TABLE IF NOT EXISTS league_team_rosters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  division_id UUID NOT NULL REFERENCES league_divisions(id) ON DELETE CASCADE,
  club_id UUID NOT NULL REFERENCES league_clubs(id) ON DELETE CASCADE,

  player_name TEXT NOT NULL,
  player_email TEXT,
  player_phone TEXT,
  parent_name TEXT,
  parent_email TEXT,
  parent_phone TEXT,

  -- Rating fields (juniors typically have UTR; NTRP optional)
  ntrp NUMERIC(2,1),
  utr NUMERIC(4,2),
  utr_id TEXT,
  wtn NUMERIC(4,2),

  -- Ladder position within the team — lower = higher on the ladder
  ladder_position INTEGER,

  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active','injured','withdrawn')
  ),

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rosters_division ON league_team_rosters(division_id);
CREATE INDEX IF NOT EXISTS idx_rosters_club ON league_team_rosters(club_id);
CREATE INDEX IF NOT EXISTS idx_rosters_division_club ON league_team_rosters(division_id, club_id);

-- ============================================
-- league_team_matchups — weekly Club A vs Club B fixtures
-- ============================================
CREATE TABLE IF NOT EXISTS league_team_matchups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  division_id UUID NOT NULL REFERENCES league_divisions(id) ON DELETE CASCADE,

  match_date DATE NOT NULL,
  start_time TIME,                          -- override division default if needed

  home_club_id UUID NOT NULL REFERENCES league_clubs(id) ON DELETE CASCADE,
  away_club_id UUID NOT NULL REFERENCES league_clubs(id) ON DELETE CASCADE,

  -- Aggregate line scores (maintained by trigger / server-side math)
  home_lines_won INTEGER NOT NULL DEFAULT 0,
  away_lines_won INTEGER NOT NULL DEFAULT 0,

  -- Who won the overall matchup ('home' | 'away' | 'tie' | null if pending)
  winner TEXT CHECK (winner IN ('home','away','tie')),

  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (
    status IN ('scheduled','in_progress','completed','cancelled','postponed')
  ),

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CHECK (home_club_id <> away_club_id)
);

CREATE INDEX IF NOT EXISTS idx_matchups_division ON league_team_matchups(division_id);
CREATE INDEX IF NOT EXISTS idx_matchups_date ON league_team_matchups(match_date);
CREATE INDEX IF NOT EXISTS idx_matchups_home ON league_team_matchups(home_club_id);
CREATE INDEX IF NOT EXISTS idx_matchups_away ON league_team_matchups(away_club_id);

-- ============================================
-- league_matchup_lines — individual lines within a matchup
-- A 10&U matchup typically has one singles line + one doubles line.
-- ============================================
CREATE TABLE IF NOT EXISTS league_matchup_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  matchup_id UUID NOT NULL REFERENCES league_team_matchups(id) ON DELETE CASCADE,

  line_type TEXT NOT NULL CHECK (line_type IN ('singles','doubles')),
  line_number INTEGER NOT NULL,             -- 1, 2, 3... within the matchup

  -- Home players (roster FKs)
  home_player1_id UUID REFERENCES league_team_rosters(id) ON DELETE SET NULL,
  home_player2_id UUID REFERENCES league_team_rosters(id) ON DELETE SET NULL, -- null for singles

  -- Away players (roster FKs)
  away_player1_id UUID REFERENCES league_team_rosters(id) ON DELETE SET NULL,
  away_player2_id UUID REFERENCES league_team_rosters(id) ON DELETE SET NULL, -- null for singles

  score TEXT,                               -- "6-3, 6-4"
  winner TEXT CHECK (winner IN ('home','away')),

  -- Scoring audit trail — who entered it
  reported_at TIMESTAMPTZ,
  reported_by_token TEXT,
  reported_by_name TEXT,                    -- fallback when a coach enters live

  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending','in_progress','completed','defaulted','cancelled')
  ),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(matchup_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_lines_matchup ON league_matchup_lines(matchup_id);
CREATE INDEX IF NOT EXISTS idx_lines_status ON league_matchup_lines(status);

-- ============================================
-- Trigger: when a line is scored, recompute matchup aggregates
-- ============================================
CREATE OR REPLACE FUNCTION recompute_matchup_from_lines() RETURNS TRIGGER AS $$
DECLARE
  v_home INTEGER;
  v_away INTEGER;
  v_total INTEGER;
  v_completed INTEGER;
  v_matchup_id UUID;
BEGIN
  v_matchup_id := COALESCE(NEW.matchup_id, OLD.matchup_id);

  SELECT
    COUNT(*) FILTER (WHERE winner = 'home'),
    COUNT(*) FILTER (WHERE winner = 'away'),
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'completed')
  INTO v_home, v_away, v_total, v_completed
  FROM league_matchup_lines
  WHERE matchup_id = v_matchup_id;

  UPDATE league_team_matchups
  SET
    home_lines_won = v_home,
    away_lines_won = v_away,
    winner = CASE
      WHEN v_completed < v_total THEN NULL
      WHEN v_home > v_away THEN 'home'
      WHEN v_away > v_home THEN 'away'
      ELSE 'tie'
    END,
    status = CASE
      WHEN v_completed = 0 THEN status                 -- leave as scheduled
      WHEN v_completed < v_total THEN 'in_progress'
      ELSE 'completed'
    END,
    updated_at = NOW()
  WHERE id = v_matchup_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lines_recompute_matchup ON league_matchup_lines;
CREATE TRIGGER trg_lines_recompute_matchup
  AFTER INSERT OR UPDATE OR DELETE ON league_matchup_lines
  FOR EACH ROW EXECUTE FUNCTION recompute_matchup_from_lines();

-- ============================================
-- updated_at triggers (reuse existing touch_leagues_updated_at function
-- from leagues.sql)
-- ============================================
DROP TRIGGER IF EXISTS trg_league_clubs_updated_at ON league_clubs;
CREATE TRIGGER trg_league_clubs_updated_at
  BEFORE UPDATE ON league_clubs
  FOR EACH ROW EXECUTE FUNCTION touch_leagues_updated_at();

DROP TRIGGER IF EXISTS trg_rosters_updated_at ON league_team_rosters;
CREATE TRIGGER trg_rosters_updated_at
  BEFORE UPDATE ON league_team_rosters
  FOR EACH ROW EXECUTE FUNCTION touch_leagues_updated_at();

DROP TRIGGER IF EXISTS trg_matchups_updated_at ON league_team_matchups;
CREATE TRIGGER trg_matchups_updated_at
  BEFORE UPDATE ON league_team_matchups
  FOR EACH ROW EXECUTE FUNCTION touch_leagues_updated_at();

DROP TRIGGER IF EXISTS trg_lines_updated_at ON league_matchup_lines;
CREATE TRIGGER trg_lines_updated_at
  BEFORE UPDATE ON league_matchup_lines
  FOR EACH ROW EXECUTE FUNCTION touch_leagues_updated_at();

-- ============================================
-- Row-level security
-- ============================================
ALTER TABLE league_clubs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_divisions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_division_clubs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_team_rosters     ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_team_matchups    ENABLE ROW LEVEL SECURITY;
ALTER TABLE league_matchup_lines    ENABLE ROW LEVEL SECURITY;

-- Helpers: "user is director of this league" / "league is published"
-- We inline these checks per policy to match the existing leagues pattern.

-- Clubs
DROP POLICY IF EXISTS "Directors manage league clubs" ON league_clubs;
CREATE POLICY "Directors manage league clubs" ON league_clubs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM leagues l WHERE l.id = league_id AND l.director_id = auth.uid())
  );
DROP POLICY IF EXISTS "Public can view league clubs" ON league_clubs;
CREATE POLICY "Public can view league clubs" ON league_clubs
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM leagues l WHERE l.id = league_id
            AND l.status IN ('open','closed','running','completed'))
  );

-- Divisions
DROP POLICY IF EXISTS "Directors manage league divisions" ON league_divisions;
CREATE POLICY "Directors manage league divisions" ON league_divisions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM leagues l WHERE l.id = league_id AND l.director_id = auth.uid())
  );
DROP POLICY IF EXISTS "Public can view league divisions" ON league_divisions;
CREATE POLICY "Public can view league divisions" ON league_divisions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM leagues l WHERE l.id = league_id
            AND l.status IN ('open','closed','running','completed'))
  );

-- Division clubs (join)
DROP POLICY IF EXISTS "Directors manage division clubs" ON league_division_clubs;
CREATE POLICY "Directors manage division clubs" ON league_division_clubs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM league_divisions d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = division_id AND l.director_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Public can view division clubs" ON league_division_clubs;
CREATE POLICY "Public can view division clubs" ON league_division_clubs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM league_divisions d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = division_id AND l.status IN ('open','closed','running','completed')
    )
  );

-- Rosters: directors read/write all; public sees only published leagues
DROP POLICY IF EXISTS "Directors manage rosters" ON league_team_rosters;
CREATE POLICY "Directors manage rosters" ON league_team_rosters
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM league_divisions d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = division_id AND l.director_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Public can view rosters" ON league_team_rosters;
CREATE POLICY "Public can view rosters" ON league_team_rosters
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM league_divisions d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = division_id AND l.status IN ('running','completed')
    )
  );

-- Matchups: same pattern
DROP POLICY IF EXISTS "Directors manage matchups" ON league_team_matchups;
CREATE POLICY "Directors manage matchups" ON league_team_matchups
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM league_divisions d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = division_id AND l.director_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Public can view matchups" ON league_team_matchups;
CREATE POLICY "Public can view matchups" ON league_team_matchups
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM league_divisions d
      JOIN leagues l ON l.id = d.league_id
      WHERE d.id = division_id AND l.status IN ('open','closed','running','completed')
    )
  );

-- Lines: directors manage; public reads when league is running/completed
DROP POLICY IF EXISTS "Directors manage lines" ON league_matchup_lines;
CREATE POLICY "Directors manage lines" ON league_matchup_lines
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM league_team_matchups m
      JOIN league_divisions d ON d.id = m.division_id
      JOIN leagues l ON l.id = d.league_id
      WHERE m.id = matchup_id AND l.director_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Public can view lines" ON league_matchup_lines;
CREATE POLICY "Public can view lines" ON league_matchup_lines
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM league_team_matchups m
      JOIN league_divisions d ON d.id = m.division_id
      JOIN leagues l ON l.id = d.league_id
      WHERE m.id = matchup_id AND l.status IN ('running','completed')
    )
  );
