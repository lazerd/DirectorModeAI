-- ============================================
-- PTL — the snake draft
-- ============================================
-- Captains draft from their own phone or laptop, Yahoo-style. Nobody has to be
-- in the same room, and nobody needs an account: ptl_teams.team_token is the
-- credential.
--
-- WHY ALL THE PICK LOGIC IS IN THE DATABASE
--
-- The one thing a draft cannot ever do is give the same player to two teams.
-- Two captains tapping the same name in the same second is not an edge case,
-- it is the normal way a draft room behaves when a run starts. Client-side
-- "is this player still available?" checks lose that race every time, so the
-- whole pick is one transaction that opens by taking a row lock on the draft:
--
--   SELECT ... FROM ptl_drafts WHERE id = ... FOR UPDATE
--
-- Every pick in a draft serialises behind that single row. The two UNIQUE
-- constraints on ptl_draft_picks and the UNIQUE(season_id, entry_id) on
-- ptl_roster are the backstop if a future caller ever forgets.
--
-- THE PICK CLOCK, WITHOUT A CRON
--
-- Vercel Hobby allows one cron a day, and a 90-second clock could not be
-- driven by cron anyway. Instead the deadline is server-authoritative —
-- ptl_drafts.current_deadline_at — and every connected client just renders a
-- countdown from it. Whichever client hits zero first POSTs to the tick route,
-- which calls ptl_tick(). ptl_tick re-checks the deadline INSIDE the row lock,
-- so a late tick, a duplicate tick from five browsers, or a tick from someone
-- with a slow clock are all no-ops. The commissioner's board is always open,
-- so there is always at least one ticker.
--
-- KEEPERS
--
-- A playing captain protects 1 player, a non-playing captain 2. Keepers are
-- inserted into ptl_roster up front with acquired = 'keeper', which means they
-- occupy roster slots and that team simply runs out of picks earlier than the
-- others. ptl_next_open_pick skips any slot whose team is already full, so the
-- snake order handles keepers with no special case.
--
-- Safe to re-run.
-- ============================================

-- ============================================
-- Tables
-- ============================================
CREATE TABLE IF NOT EXISTS ptl_drafts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID NOT NULL UNIQUE REFERENCES ptl_seasons(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending','live','paused','complete')
  ),

  pick_seconds INTEGER NOT NULL DEFAULT 90,
  rounds INTEGER NOT NULL DEFAULT 9,

  -- NULL once the draft is complete. Always points at a pick belonging to a
  -- team that still has roster space (see ptl_next_open_pick).
  current_pick_no INTEGER,
  current_deadline_at TIMESTAMPTZ,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ptl_draft_picks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  draft_id UUID NOT NULL REFERENCES ptl_drafts(id) ON DELETE CASCADE,

  pick_no INTEGER NOT NULL,
  round_no INTEGER NOT NULL,
  slot_no INTEGER NOT NULL,

  team_id UUID NOT NULL REFERENCES ptl_teams(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES ptl_entries(id) ON DELETE CASCADE,

  is_auto BOOLEAN NOT NULL DEFAULT FALSE,
  made_by TEXT,
  made_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(draft_id, pick_no),
  UNIQUE(draft_id, entry_id)
);

CREATE INDEX IF NOT EXISTS idx_ptl_picks_draft ON ptl_draft_picks(draft_id, pick_no);
CREATE INDEX IF NOT EXISTS idx_ptl_picks_team ON ptl_draft_picks(team_id);

-- A captain's private wishlist. NEVER published to realtime and never readable
-- by anon — the whole point is that the other captains cannot see it.
CREATE TABLE IF NOT EXISTS ptl_draft_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  draft_id UUID NOT NULL REFERENCES ptl_drafts(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES ptl_teams(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES ptl_entries(id) ON DELETE CASCADE,

  rank INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(draft_id, team_id, entry_id)
);

CREATE INDEX IF NOT EXISTS idx_ptl_queue_team ON ptl_draft_queue(draft_id, team_id, rank);

-- Protected players, chosen before the draft opens.
CREATE TABLE IF NOT EXISTS ptl_keepers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  season_id UUID NOT NULL REFERENCES ptl_seasons(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES ptl_teams(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES ptl_entries(id) ON DELETE CASCADE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(season_id, entry_id)
);

DROP TRIGGER IF EXISTS trg_ptl_drafts_touch ON ptl_drafts;
CREATE TRIGGER trg_ptl_drafts_touch BEFORE UPDATE ON ptl_drafts
  FOR EACH ROW EXECUTE FUNCTION ptl_touch_updated_at();

-- ============================================
-- Snake order
-- ============================================
-- Round 1 runs slot 1..n, round 2 runs n..1, and so on. Pure arithmetic on the
-- pick number so the order never has to be materialised or kept in sync.
CREATE OR REPLACE FUNCTION ptl_draft_round(p_pick INTEGER, p_n INTEGER)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$
  SELECT ((p_pick - 1) / p_n) + 1;
$$;

CREATE OR REPLACE FUNCTION ptl_snake_slot(p_pick INTEGER, p_n INTEGER)
RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN (((p_pick - 1) / p_n) + 1) % 2 = 1
      THEN ((p_pick - 1) % p_n) + 1          -- odd round: left to right
      ELSE p_n - ((p_pick - 1) % p_n)        -- even round: right to left
  END;
$$;

-- The next pick number at or after p_from whose team still has roster space.
-- Returns NULL when every team is full or the rounds are exhausted — which is
-- how the caller learns the draft is over.
CREATE OR REPLACE FUNCTION ptl_next_open_pick(
  p_season UUID, p_from INTEGER, p_n INTEGER, p_rounds INTEGER, p_roster_size INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_pick INTEGER := GREATEST(p_from, 1);
  v_total INTEGER := p_n * p_rounds;
  v_team UUID;
  v_cnt INTEGER;
BEGIN
  WHILE v_pick <= v_total LOOP
    SELECT id INTO v_team
      FROM ptl_teams
     WHERE season_id = p_season AND draft_slot = ptl_snake_slot(v_pick, p_n);
    IF v_team IS NULL THEN
      RAISE EXCEPTION 'PTL_DRAFT_SLOTS_INCOMPLETE';
    END IF;
    SELECT count(*) INTO v_cnt FROM ptl_roster WHERE team_id = v_team;
    IF v_cnt < p_roster_size THEN
      RETURN v_pick;
    END IF;
    v_pick := v_pick + 1;
  END LOOP;
  RETURN NULL;
END;
$$;

-- ============================================
-- State snapshot — what every draft surface renders from
-- ============================================
CREATE OR REPLACE FUNCTION ptl_draft_state(p_draft UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  d ptl_drafts%ROWTYPE;
  v_n INTEGER;
  v_team UUID;
BEGIN
  SELECT * INTO d FROM ptl_drafts WHERE id = p_draft;
  IF NOT FOUND THEN RAISE EXCEPTION 'PTL_DRAFT_NOT_FOUND'; END IF;

  SELECT count(*) INTO v_n FROM ptl_teams WHERE season_id = d.season_id;

  IF d.current_pick_no IS NOT NULL AND v_n > 0 THEN
    SELECT id INTO v_team FROM ptl_teams
     WHERE season_id = d.season_id AND draft_slot = ptl_snake_slot(d.current_pick_no, v_n);
  END IF;

  RETURN jsonb_build_object(
    'draft_id', d.id,
    'season_id', d.season_id,
    'status', d.status,
    'pick_seconds', d.pick_seconds,
    'rounds', d.rounds,
    'teams', v_n,
    'current_pick_no', d.current_pick_no,
    'current_round_no',
      CASE WHEN d.current_pick_no IS NULL OR v_n = 0 THEN NULL
           ELSE ptl_draft_round(d.current_pick_no, v_n) END,
    'current_slot_no',
      CASE WHEN d.current_pick_no IS NULL OR v_n = 0 THEN NULL
           ELSE ptl_snake_slot(d.current_pick_no, v_n) END,
    'on_the_clock_team_id', v_team,
    'current_deadline_at', d.current_deadline_at,
    'picks_made', (SELECT count(*) FROM ptl_draft_picks WHERE draft_id = d.id)
  );
END;
$$;

-- ============================================
-- Division placement — "placement follows the draft, by roster strength"
-- ============================================
-- Teams are ranked by the mean composite rating of their roster and dealt into
-- divisions top-down, so all three start balanced on paper and the season
-- decides the rest.
CREATE OR REPLACE FUNCTION ptl_place_divisions(p_season UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_teams INTEGER;
  v_divs INTEGER;
  v_per INTEGER;
  v_updated INTEGER;
BEGIN
  SELECT count(*) INTO v_teams FROM ptl_teams WHERE season_id = p_season;
  SELECT count(*) INTO v_divs FROM ptl_divisions WHERE season_id = p_season;
  IF v_divs = 0 OR v_teams = 0 THEN RETURN 0; END IF;

  v_per := CEIL(v_teams::NUMERIC / v_divs)::INTEGER;

  WITH strength AS (
    SELECT t.id, COALESCE(AVG(e.composite_score), 0) AS avg_score
      FROM ptl_teams t
      LEFT JOIN ptl_roster r ON r.team_id = t.id
      LEFT JOIN ptl_entries e ON e.id = r.entry_id
     WHERE t.season_id = p_season
     GROUP BY t.id
  ), ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY avg_score DESC, id) AS rn FROM strength
  ), divs AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY tier ASC) AS drn
      FROM ptl_divisions WHERE season_id = p_season
  )
  UPDATE ptl_teams t
     SET division_id = divs.id
    FROM ranked, divs
   WHERE t.id = ranked.id
     AND divs.drn = LEAST(((ranked.rn - 1) / v_per) + 1, v_divs);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

-- ============================================
-- Start / pause / resume
-- ============================================
CREATE OR REPLACE FUNCTION ptl_start_draft(p_draft UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d ptl_drafts%ROWTYPE;
  s ptl_seasons%ROWTYPE;
  v_n INTEGER;
  v_slots INTEGER;
  v_next INTEGER;
BEGIN
  SELECT * INTO d FROM ptl_drafts WHERE id = p_draft FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PTL_DRAFT_NOT_FOUND'; END IF;
  IF d.status = 'complete' THEN RAISE EXCEPTION 'PTL_DRAFT_COMPLETE'; END IF;
  IF d.status = 'live' THEN RETURN ptl_draft_state(p_draft); END IF;

  SELECT * INTO s FROM ptl_seasons WHERE id = d.season_id;
  SELECT count(*) INTO v_n FROM ptl_teams WHERE season_id = d.season_id;
  IF v_n < 2 THEN RAISE EXCEPTION 'PTL_NOT_ENOUGH_TEAMS'; END IF;

  -- Slots must be exactly 1..n, or the snake has a hole in it.
  SELECT count(DISTINCT draft_slot) INTO v_slots
    FROM ptl_teams
   WHERE season_id = d.season_id AND draft_slot BETWEEN 1 AND v_n;
  IF v_slots <> v_n THEN RAISE EXCEPTION 'PTL_DRAFT_SLOTS_INCOMPLETE'; END IF;

  -- Resuming keeps the pick it was on; a cold start finds the first open pick,
  -- which skips any team already full of keepers.
  v_next := COALESCE(
    d.current_pick_no,
    ptl_next_open_pick(d.season_id, 1, v_n, d.rounds, s.roster_size)
  );
  IF v_next IS NULL THEN RAISE EXCEPTION 'PTL_NOTHING_TO_DRAFT'; END IF;

  UPDATE ptl_drafts
     SET status = 'live',
         current_pick_no = v_next,
         current_deadline_at = NOW() + (d.pick_seconds || ' seconds')::INTERVAL,
         started_at = COALESCE(started_at, NOW())
   WHERE id = p_draft;

  RETURN ptl_draft_state(p_draft);
END;
$$;

-- Pausing clears the deadline so no client can tick an auto-pick while the
-- commissioner is sorting something out. Resuming gives a full fresh clock.
CREATE OR REPLACE FUNCTION ptl_pause_draft(p_draft UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE ptl_drafts
     SET status = 'paused', current_deadline_at = NULL
   WHERE id = p_draft AND status = 'live';
  RETURN ptl_draft_state(p_draft);
END;
$$;

-- ============================================
-- ptl_make_pick — the only way a player joins a roster during a draft
-- ============================================
CREATE OR REPLACE FUNCTION ptl_make_pick(
  p_draft UUID,
  p_team UUID,
  p_entry UUID,
  p_auto BOOLEAN DEFAULT FALSE,
  p_actor TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d ptl_drafts%ROWTYPE;
  s ptl_seasons%ROWTYPE;
  v_n INTEGER;
  v_expected_slot INTEGER;
  v_team_slot INTEGER;
  v_round INTEGER;
  v_next INTEGER;
BEGIN
  -- Serialises every pick in this draft behind one row.
  SELECT * INTO d FROM ptl_drafts WHERE id = p_draft FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PTL_DRAFT_NOT_FOUND'; END IF;
  IF d.status <> 'live' THEN RAISE EXCEPTION 'PTL_DRAFT_NOT_LIVE'; END IF;
  IF d.current_pick_no IS NULL THEN RAISE EXCEPTION 'PTL_DRAFT_COMPLETE'; END IF;

  SELECT * INTO s FROM ptl_seasons WHERE id = d.season_id;
  SELECT count(*) INTO v_n FROM ptl_teams WHERE season_id = d.season_id;
  IF v_n < 2 THEN RAISE EXCEPTION 'PTL_NOT_ENOUGH_TEAMS'; END IF;

  v_expected_slot := ptl_snake_slot(d.current_pick_no, v_n);
  v_round := ptl_draft_round(d.current_pick_no, v_n);

  SELECT draft_slot INTO v_team_slot
    FROM ptl_teams WHERE id = p_team AND season_id = d.season_id;
  IF v_team_slot IS NULL THEN RAISE EXCEPTION 'PTL_TEAM_NOT_IN_SEASON'; END IF;
  IF v_team_slot <> v_expected_slot THEN RAISE EXCEPTION 'PTL_NOT_YOUR_TURN'; END IF;

  PERFORM 1 FROM ptl_entries
   WHERE id = p_entry AND season_id = d.season_id AND status = 'confirmed';
  IF NOT FOUND THEN RAISE EXCEPTION 'PTL_ENTRY_NOT_AVAILABLE'; END IF;

  PERFORM 1 FROM ptl_roster WHERE season_id = d.season_id AND entry_id = p_entry;
  IF FOUND THEN RAISE EXCEPTION 'PTL_ENTRY_ALREADY_DRAFTED'; END IF;

  INSERT INTO ptl_draft_picks(draft_id, pick_no, round_no, slot_no, team_id, entry_id, is_auto, made_by)
  VALUES (p_draft, d.current_pick_no, v_round, v_expected_slot, p_team, p_entry, p_auto, p_actor);

  INSERT INTO ptl_roster(season_id, team_id, entry_id, acquired, pick_no)
  VALUES (d.season_id, p_team, p_entry, 'draft', d.current_pick_no);

  -- A drafted player leaves EVERY captain's queue, not just the one who got
  -- them — otherwise eight other auto-picks would fire at a name that's gone.
  DELETE FROM ptl_draft_queue WHERE draft_id = p_draft AND entry_id = p_entry;

  v_next := ptl_next_open_pick(d.season_id, d.current_pick_no + 1, v_n, d.rounds, s.roster_size);

  IF v_next IS NULL THEN
    UPDATE ptl_drafts
       SET current_pick_no = NULL, current_deadline_at = NULL,
           status = 'complete', completed_at = NOW()
     WHERE id = p_draft;
    PERFORM ptl_place_divisions(d.season_id);
    UPDATE ptl_seasons SET status = 'running' WHERE id = d.season_id AND status = 'drafting';
  ELSE
    UPDATE ptl_drafts
       SET current_pick_no = v_next,
           current_deadline_at = NOW() + (d.pick_seconds || ' seconds')::INTERVAL
     WHERE id = p_draft;
  END IF;

  RETURN ptl_draft_state(p_draft);
END;
$$;

-- ============================================
-- ptl_tick — the clock expiring, made safe to call from anywhere
-- ============================================
-- Any client whose countdown reaches zero may call this. The deadline is
-- re-read inside the row lock, so ticks that arrive late, twice, or from a
-- browser with a skewed clock simply return the current state and change
-- nothing.
CREATE OR REPLACE FUNCTION ptl_tick(p_draft UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d ptl_drafts%ROWTYPE;
  v_n INTEGER;
  v_team UUID;
  v_entry UUID;
BEGIN
  SELECT * INTO d FROM ptl_drafts WHERE id = p_draft FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PTL_DRAFT_NOT_FOUND'; END IF;

  -- Not live, already finished, or the clock has not actually run out.
  IF d.status <> 'live'
     OR d.current_pick_no IS NULL
     OR d.current_deadline_at IS NULL
     OR NOW() < d.current_deadline_at THEN
    RETURN ptl_draft_state(p_draft);
  END IF;

  SELECT count(*) INTO v_n FROM ptl_teams WHERE season_id = d.season_id;
  SELECT id INTO v_team FROM ptl_teams
   WHERE season_id = d.season_id AND draft_slot = ptl_snake_slot(d.current_pick_no, v_n);

  -- Highest-ranked player still available on this captain's queue.
  SELECT q.entry_id INTO v_entry
    FROM ptl_draft_queue q
    JOIN ptl_entries e ON e.id = q.entry_id AND e.status = 'confirmed'
   WHERE q.draft_id = p_draft
     AND q.team_id = v_team
     AND NOT EXISTS (
       SELECT 1 FROM ptl_roster r
        WHERE r.season_id = d.season_id AND r.entry_id = q.entry_id)
   ORDER BY q.rank ASC
   LIMIT 1;

  -- Empty queue falls back to best available by composite rating, so a captain
  -- who never opened the page still ends up with a defensible roster.
  IF v_entry IS NULL THEN
    SELECT e.id INTO v_entry
      FROM ptl_entries e
     WHERE e.season_id = d.season_id
       AND e.status = 'confirmed'
       AND NOT EXISTS (
         SELECT 1 FROM ptl_roster r
          WHERE r.season_id = d.season_id AND r.entry_id = e.id)
     ORDER BY e.composite_score DESC NULLS LAST, e.created_at ASC
     LIMIT 1;
  END IF;

  IF v_entry IS NULL THEN RAISE EXCEPTION 'PTL_POOL_EMPTY'; END IF;

  -- Re-locking the same row inside the same transaction is free.
  RETURN ptl_make_pick(p_draft, v_team, v_entry, TRUE, 'autopick');
END;
$$;

-- ============================================
-- ptl_undo_last_pick — the commissioner's eraser
-- ============================================
-- Rewinds exactly one pick and hands the clock back to the team that made it.
-- If the draft had just completed, it reopens and the division placement is
-- cleared, because placement is derived from full rosters.
CREATE OR REPLACE FUNCTION ptl_undo_last_pick(p_draft UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d ptl_drafts%ROWTYPE;
  v_pick ptl_draft_picks%ROWTYPE;
BEGIN
  SELECT * INTO d FROM ptl_drafts WHERE id = p_draft FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PTL_DRAFT_NOT_FOUND'; END IF;

  SELECT * INTO v_pick FROM ptl_draft_picks
   WHERE draft_id = p_draft ORDER BY pick_no DESC LIMIT 1;
  IF NOT FOUND THEN RETURN ptl_draft_state(p_draft); END IF;

  DELETE FROM ptl_roster WHERE season_id = d.season_id AND entry_id = v_pick.entry_id;
  DELETE FROM ptl_draft_picks WHERE id = v_pick.id;

  IF d.status = 'complete' THEN
    UPDATE ptl_teams SET division_id = NULL WHERE season_id = d.season_id;
    UPDATE ptl_seasons SET status = 'drafting' WHERE id = d.season_id AND status = 'running';
  END IF;

  UPDATE ptl_drafts
     SET status = 'live',
         completed_at = NULL,
         current_pick_no = v_pick.pick_no,
         current_deadline_at = NOW() + (d.pick_seconds || ' seconds')::INTERVAL
   WHERE id = p_draft;

  RETURN ptl_draft_state(p_draft);
END;
$$;

-- ============================================
-- Access
-- ============================================
-- The live board and the pick clock are projected on a wall — they are public
-- by design, and the browser anon key subscribes to them directly because
-- Supabase Realtime filters postgres_changes through RLS. So these two tables,
-- and only these two, get a read policy for anon.
--
-- ptl_draft_queue is the opposite: a captain's private board. RLS on, no
-- policy, grants revoked, and deliberately NOT in the realtime publication.
ALTER TABLE ptl_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ptl_draft_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ptl_draft_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE ptl_keepers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ptl_drafts_public_read ON ptl_drafts;
CREATE POLICY ptl_drafts_public_read ON ptl_drafts FOR SELECT TO anon, authenticated USING (TRUE);

DROP POLICY IF EXISTS ptl_picks_public_read ON ptl_draft_picks;
CREATE POLICY ptl_picks_public_read ON ptl_draft_picks FOR SELECT TO anon, authenticated USING (TRUE);

REVOKE ALL ON TABLE ptl_drafts FROM anon, authenticated;
REVOKE ALL ON TABLE ptl_draft_picks FROM anon, authenticated;
REVOKE ALL ON TABLE ptl_draft_queue FROM anon, authenticated;
REVOKE ALL ON TABLE ptl_keepers FROM anon, authenticated;

GRANT SELECT ON TABLE ptl_drafts TO anon, authenticated;
GRANT SELECT ON TABLE ptl_draft_picks TO anon, authenticated;

-- Mutations are service-role only. Every route that calls these has already
-- checked a team token or a commissioner session.
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'ptl_make_pick(uuid,uuid,uuid,boolean,text)',
    'ptl_tick(uuid)',
    'ptl_start_draft(uuid)',
    'ptl_pause_draft(uuid)',
    'ptl_undo_last_pick(uuid)',
    'ptl_place_divisions(uuid)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;

-- ============================================
-- Realtime
-- ============================================
-- Same idempotent guard as leagues_realtime.sql so re-applying is a no-op.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ptl_drafts','ptl_draft_picks']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
