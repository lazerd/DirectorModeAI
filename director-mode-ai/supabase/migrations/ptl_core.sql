-- ============================================
-- PTL — Premier Tennis League
-- ============================================
-- A standalone 5.0+ adult league product. Players enroll INDIVIDUALLY,
-- captains draft them in a live snake draft, teams land in divisions by
-- roster strength, and a division of 4 plays a full round robin in one
-- ~3-hour night (each meeting = 1 singles + 1 doubles, side by side).
--
-- WHY ITS OWN TABLES, and not the JTT ones it superficially resembles:
--
-- league_clubs / league_divisions / league_team_rosters / league_team_matchups
-- / league_matchup_lines run the LIVE Lamorinda JTT league. league_matchup_lines
-- carries a trigger (recompute_matchup_from_lines) that decides a matchup by
-- counting lines won. PTL cannot be resolved that way — a 1-1 split goes to
-- total games, then to a pair of 7-point tiebreaks, then to a race to 14, then
-- to a 2-of-3 point tiebreak. Teaching that trigger a second dialect would put
-- a live league one bad WHERE clause away from silently rescoring real matches.
--
-- So: same shapes, separate tables. The reuse is in the app layer (tokenized
-- no-login links, Resend + unsubscribe, the realtime pattern, the composite
-- rating blender in src/lib/leagueRatings.ts) — not in the rows.
--
-- ACCESS MODEL. Every table has RLS on. Only two are readable by `anon`:
-- ptl_drafts and ptl_draft_picks, because the live draft board subscribes to
-- them with the browser anon key and Supabase Realtime filters postgres_changes
-- through RLS. A pick is public information by design — the board is projected
-- on a wall. Everything else (entries carry email + phone, queues carry a
-- captain's private wishlist) is service-role only and reached through
-- getSupabaseAdmin() in a route that has checked a token or a session.
--
-- Safe to re-run.
-- ============================================

-- ============================================
-- ptl_seasons — the container for one PTL season
-- ============================================
CREATE TABLE IF NOT EXISTS ptl_seasons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  name TEXT NOT NULL,                       -- 'Spring 2027'
  slug TEXT NOT NULL UNIQUE,                -- 'spring-2027'
  commissioner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN ('draft','enrolling','drafting','running','complete','archived')
  ),

  -- Format knobs. Defaults are the numbers in the proposal.
  entry_cents INTEGER NOT NULL DEFAULT 5000,      -- $50
  roster_size INTEGER NOT NULL DEFAULT 9,
  pick_seconds INTEGER NOT NULL DEFAULT 90,
  courts_per_division INTEGER NOT NULL DEFAULT 4,
  season_prize_cents INTEGER NOT NULL DEFAULT 0,  -- display only; sums the divisions

  enroll_opens_at TIMESTAMPTZ,
  enroll_closes_at TIMESTAMPTZ,

  -- Free-text so the public page can explain the format without a deploy.
  tagline TEXT,
  blurb TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- ptl_divisions — Premier / Championship / Challenger
-- ============================================
-- `tier` is the ladder rung, 1 = top. Promotion/relegation moves a team's
-- division_id between seasons by comparing tiers, so tier must be unique
-- within a season and contiguous from 1.
CREATE TABLE IF NOT EXISTS ptl_divisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID NOT NULL REFERENCES ptl_seasons(id) ON DELETE CASCADE,

  name TEXT NOT NULL,                       -- 'Premier'
  short_code TEXT NOT NULL,                 -- 'PREM'
  tier INTEGER NOT NULL,                    -- 1 = Premier

  nightly_prize_cents INTEGER NOT NULL DEFAULT 0,
  finals_prize_cents INTEGER NOT NULL DEFAULT 0,

  -- Schedule template for the division's night.
  day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),  -- 0 = Sunday
  start_time TIME,
  end_time TIME,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, short_code),
  UNIQUE(season_id, tier)
);

CREATE INDEX IF NOT EXISTS idx_ptl_divisions_season ON ptl_divisions(season_id);

-- ============================================
-- ptl_teams — the drafted teams
-- ============================================
-- division_id is NULL until the draft completes: placement follows the draft,
-- by roster strength (ptl_place_divisions). ON DELETE SET NULL so removing a
-- division doesn't take the teams with it.
CREATE TABLE IF NOT EXISTS ptl_teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID NOT NULL REFERENCES ptl_seasons(id) ON DELETE CASCADE,
  division_id UUID REFERENCES ptl_divisions(id) ON DELETE SET NULL,

  name TEXT NOT NULL,
  short_code TEXT NOT NULL,
  color TEXT,

  -- The captain never needs an account. This token IS the credential for the
  -- draft room, exactly as captain_players/player_token works in CaptainMode.
  team_token TEXT NOT NULL UNIQUE,

  captain_name TEXT,
  captain_email TEXT,
  captain_phone TEXT,
  -- A playing captain protects 1 player; a non-playing captain protects 2.
  captain_is_playing BOOLEAN NOT NULL DEFAULT TRUE,

  -- Position in round 1 of the snake. Rounds alternate direction from here.
  draft_slot INTEGER,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, short_code),
  UNIQUE(season_id, draft_slot)
);

CREATE INDEX IF NOT EXISTS idx_ptl_teams_season ON ptl_teams(season_id);
CREATE INDEX IF NOT EXISTS idx_ptl_teams_division ON ptl_teams(division_id);

-- ============================================
-- ptl_entries — individual enrollment (the draft pool)
-- ============================================
-- One row per person who signed up. Ratings are blended into composite_score
-- by src/lib/leagueRatings.ts computeCompositeRating() — the same blender the
-- existing league signup uses — which is what orders the pool and what
-- auto-pick falls back to.
CREATE TABLE IF NOT EXISTS ptl_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID NOT NULL REFERENCES ptl_seasons(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  home_club TEXT,

  ntrp NUMERIC(2,1),
  utr NUMERIC(4,2),
  utr_id TEXT,
  wtn NUMERIC(4,2),

  composite_score NUMERIC(5,2),
  rating_source TEXT,
  rating_confidence TEXT,
  flag_discrepancy BOOLEAN NOT NULL DEFAULT FALSE,

  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (
    status IN ('pending','confirmed','withdrawn','waitlist')
  ),
  -- Carried from day one even though v1 collects nothing: NorCal will most
  -- likely take the $50 themselves, and the commissioner still needs somewhere
  -- to record who has paid.
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (
    payment_status IN ('unpaid','paid','comped','refunded')
  ),

  player_token TEXT NOT NULL UNIQUE,
  master_player_id UUID,

  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ptl_entries_season ON ptl_entries(season_id);
CREATE INDEX IF NOT EXISTS idx_ptl_entries_pool
  ON ptl_entries(season_id, composite_score DESC);
-- One enrollment per email per season. Case-insensitive because people type
-- their own address inconsistently and a duplicate here becomes a duplicate
-- in the draft pool.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ptl_entries_season_email
  ON ptl_entries(season_id, lower(email));

-- ============================================
-- ptl_roster — who ended up on which team
-- ============================================
-- season_id is denormalised so "a player is on exactly one team this season"
-- can be a single UNIQUE constraint rather than a trigger. That constraint is
-- also the last line of defence against two captains drafting the same player.
CREATE TABLE IF NOT EXISTS ptl_roster (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID NOT NULL REFERENCES ptl_seasons(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES ptl_teams(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES ptl_entries(id) ON DELETE CASCADE,

  acquired TEXT NOT NULL DEFAULT 'draft' CHECK (
    acquired IN ('keeper','draft','add')
  ),
  pick_no INTEGER,                          -- NULL for keepers and later adds

  -- Strength order within the team; lower = higher on the ladder. Drives who
  -- plays the singles line.
  ladder_position INTEGER,

  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active','injured','withdrawn')
  ),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, entry_id)
);

CREATE INDEX IF NOT EXISTS idx_ptl_roster_team ON ptl_roster(team_id);
CREATE INDEX IF NOT EXISTS idx_ptl_roster_entry ON ptl_roster(entry_id);

-- ============================================
-- ptl_nights — one division's night of tennis
-- ============================================
-- PTL publishes a grid and the host club blocks its own courts. site_name is
-- free text on purpose: host sites are mostly not ClubMode tenants, so there
-- is deliberately no FK to cc_clubs here.
CREATE TABLE IF NOT EXISTS ptl_nights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  division_id UUID NOT NULL REFERENCES ptl_divisions(id) ON DELETE CASCADE,

  week_no INTEGER,
  play_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,

  site_name TEXT,
  site_address TEXT,
  courts INTEGER NOT NULL DEFAULT 4,

  is_finals BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (
    status IN ('scheduled','live','complete','cancelled')
  ),
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ptl_nights_division ON ptl_nights(division_id);
CREATE INDEX IF NOT EXISTS idx_ptl_nights_date ON ptl_nights(play_date);

-- ============================================
-- ptl_meetings — Team A vs Team B inside a night
-- ============================================
-- A 4-team division plays 6 meetings in one night, 3 rounds of 2.
-- home_games/away_games are the level-2 tiebreak (total games won across both
-- lines) and are maintained by the app, not a trigger — see the header note.
-- decided_at_level records WHICH rung of the cascade settled it, so standings
-- and recaps can say "won on the race to 14" instead of just "won".
CREATE TABLE IF NOT EXISTS ptl_meetings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  night_id UUID NOT NULL REFERENCES ptl_nights(id) ON DELETE CASCADE,
  division_id UUID NOT NULL REFERENCES ptl_divisions(id) ON DELETE CASCADE,

  round_no INTEGER NOT NULL DEFAULT 1,
  home_team_id UUID NOT NULL REFERENCES ptl_teams(id) ON DELETE CASCADE,
  away_team_id UUID NOT NULL REFERENCES ptl_teams(id) ON DELETE CASCADE,

  result TEXT NOT NULL DEFAULT 'pending' CHECK (
    result IN ('pending','home','away','tie')
  ),
  home_games INTEGER NOT NULL DEFAULT 0,
  away_games INTEGER NOT NULL DEFAULT 0,
  home_lines_won INTEGER NOT NULL DEFAULT 0,
  away_lines_won INTEGER NOT NULL DEFAULT 0,
  decided_at_level INTEGER CHECK (decided_at_level BETWEEN 1 AND 5),

  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending','live','complete')
  ),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (home_team_id <> away_team_id),
  UNIQUE(night_id, home_team_id, away_team_id)
);

CREATE INDEX IF NOT EXISTS idx_ptl_meetings_night ON ptl_meetings(night_id);
CREATE INDEX IF NOT EXISTS idx_ptl_meetings_division ON ptl_meetings(division_id);

-- ============================================
-- ptl_lines — the singles and the doubles inside a meeting
-- ============================================
-- score_token is the magic link that lets whoever is courtside enter the score
-- with no login — same device-agnostic pattern as league_matchup_lines.
CREATE TABLE IF NOT EXISTS ptl_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id UUID NOT NULL REFERENCES ptl_meetings(id) ON DELETE CASCADE,

  line_type TEXT NOT NULL CHECK (line_type IN ('singles','doubles')),

  home_player1_id UUID REFERENCES ptl_roster(id) ON DELETE SET NULL,
  home_player2_id UUID REFERENCES ptl_roster(id) ON DELETE SET NULL,
  away_player1_id UUID REFERENCES ptl_roster(id) ON DELETE SET NULL,
  away_player2_id UUID REFERENCES ptl_roster(id) ON DELETE SET NULL,

  -- Human-readable ('4-2 4-1'), plus the parsed totals the cascade needs.
  score TEXT,
  home_games INTEGER,
  away_games INTEGER,
  winner TEXT CHECK (winner IN ('home','away')),

  court_label TEXT,
  score_token TEXT NOT NULL UNIQUE,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending','complete')
  ),
  reported_at TIMESTAMPTZ,
  reported_by_name TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(meeting_id, line_type)
);

CREATE INDEX IF NOT EXISTS idx_ptl_lines_meeting ON ptl_lines(meeting_id);

-- ============================================
-- ptl_shootouts — levels 3, 4 and 5 of the cascade
-- ============================================
-- These are not computed, they are PLAYED. A 1-1 split with games level sends
-- both pairs back out for a 7-point tiebreak (level 3); if THAT splits, the
-- combined points across the two decide it (level 4 — no extra tennis, two
-- races to 7 are already a combined race to 14); and only if the combined
-- points are also level do the singles players play a 2-of-3 point tiebreak
-- (level 5). So there are three kinds here, not four: level 4 is arithmetic on
-- the level-3 rows. The match-night screen has to notice and ask for these,
-- which is why they get their own rows rather than more nullable columns on
-- the meeting. See src/lib/ptl/meeting.ts.
CREATE TABLE IF NOT EXISTS ptl_shootouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meeting_id UUID NOT NULL REFERENCES ptl_meetings(id) ON DELETE CASCADE,

  kind TEXT NOT NULL CHECK (
    kind IN ('tb7_singles','tb7_doubles','points23')
  ),
  home_pts INTEGER NOT NULL,
  away_pts INTEGER NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(meeting_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_ptl_shootouts_meeting ON ptl_shootouts(meeting_id);

-- ============================================
-- updated_at triggers
-- ============================================
CREATE OR REPLACE FUNCTION ptl_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ptl_seasons','ptl_teams','ptl_entries','ptl_nights','ptl_meetings']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%1$s_touch ON %1$s', t);
    EXECUTE format(
      'CREATE TRIGGER trg_%1$s_touch BEFORE UPDATE ON %1$s
         FOR EACH ROW EXECUTE FUNCTION ptl_touch_updated_at()', t);
  END LOOP;
END $$;

-- ============================================
-- Lockdown
-- ============================================
-- RLS on everywhere. No policies at all on these tables, which under RLS means
-- anon and authenticated can read nothing — every PTL page reads through
-- getSupabaseAdmin() after checking a token or a session. The GRANT revokes are
-- belt-and-braces against Supabase's default grants on new public tables.
-- ptl_drafts and ptl_draft_picks get their own, deliberately public, policies
-- in ptl_draft.sql.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ptl_seasons','ptl_divisions','ptl_teams','ptl_entries','ptl_roster',
    'ptl_nights','ptl_meetings','ptl_lines','ptl_shootouts'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM anon, authenticated', t);
  END LOOP;
END $$;
