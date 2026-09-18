-- ============================================
-- PTL — roster minimums in the draft
-- ============================================
--
-- A gendered-four meeting needs a women's singles player and a women's doubles
-- pair, so a team that drafts eight men cannot field a meeting. The minimums
-- existed as numbers on the season and nothing enforced them.
--
-- THE RULE, which is the one every fantasy drafter already knows: take anyone
-- you like until your remaining picks are exactly what your minimums still
-- require, and from then on you can only take what you still need. Nobody has
-- to think about it until it binds, and when it binds it is obvious why.
--
-- Stated precisely: a pick is legal when, counting it, what the roster still
-- needs fits in the picks that are left.
--
--     still_needed(after this pick)  <=  slots_left(after this pick)
--
-- Checked inside ptl_make_pick, which every route — a captain's pick, the
-- commissioner picking for an absent captain, and the auto-pick clock — already
-- goes through. Putting it anywhere else would leave one of those three able to
-- build a roster that cannot play.
--
-- Safe to re-run.
-- ============================================

/**
 * What a team still owes, and how much room is left to pay it.
 *
 * Returned as jsonb so the draft room can render "you still need 2 women"
 * without a second round trip, and so auto-pick can filter the pool.
 */
CREATE OR REPLACE FUNCTION ptl_roster_needs(p_team UUID)
RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  s ptl_seasons%ROWTYPE;
  v_have INTEGER;
  v_men INTEGER;
  v_women INTEGER;
  v_need_m INTEGER;
  v_need_f INTEGER;
  v_slots INTEGER;
BEGIN
  SELECT se.* INTO s
    FROM ptl_seasons se JOIN ptl_teams t ON t.season_id = se.id
   WHERE t.id = p_team;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT count(*),
         count(*) FILTER (WHERE e.gender = 'm'),
         count(*) FILTER (WHERE e.gender = 'f')
    INTO v_have, v_men, v_women
    FROM ptl_roster r
    JOIN ptl_entries e ON e.id = r.entry_id
   WHERE r.team_id = p_team;

  v_need_m := GREATEST(0, s.min_men - v_men);
  v_need_f := GREATEST(0, s.min_women - v_women);
  v_slots := GREATEST(0, s.roster_size - v_have);

  RETURN jsonb_build_object(
    'roster_size', s.roster_size,
    'drafted', v_have,
    'slots_left', v_slots,
    'men', v_men,
    'women', v_women,
    'men_needed', v_need_m,
    'women_needed', v_need_f,
    -- Null until it binds. Once the outstanding minimums exactly fill the
    -- remaining picks, only that gender may be taken.
    'must_take', CASE
      WHEN v_need_m + v_need_f < v_slots THEN NULL
      WHEN v_need_m > 0 AND v_need_f > 0 THEN 'either_needed'
      WHEN v_need_m > 0 THEN 'm'
      WHEN v_need_f > 0 THEN 'f'
      ELSE NULL
    END
  );
END;
$$;

/** Could this team still meet its minimums after taking a player of p_gender? */
CREATE OR REPLACE FUNCTION ptl_gender_allowed(p_team UUID, p_gender TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  s ptl_seasons%ROWTYPE;
  v_have INTEGER;
  v_men INTEGER;
  v_women INTEGER;
  v_after_m INTEGER;
  v_after_f INTEGER;
  v_slots_after INTEGER;
BEGIN
  SELECT se.* INTO s
    FROM ptl_seasons se JOIN ptl_teams t ON t.season_id = se.id
   WHERE t.id = p_team;
  IF NOT FOUND THEN RETURN TRUE; END IF;

  -- A season with no minimums never restricts anything.
  IF s.min_men = 0 AND s.min_women = 0 THEN RETURN TRUE; END IF;

  SELECT count(*),
         count(*) FILTER (WHERE e.gender = 'm'),
         count(*) FILTER (WHERE e.gender = 'f')
    INTO v_have, v_men, v_women
    FROM ptl_roster r
    JOIN ptl_entries e ON e.id = r.entry_id
   WHERE r.team_id = p_team;

  v_after_m := v_men + (CASE WHEN p_gender = 'm' THEN 1 ELSE 0 END);
  v_after_f := v_women + (CASE WHEN p_gender = 'f' THEN 1 ELSE 0 END);
  v_slots_after := s.roster_size - (v_have + 1);

  RETURN (GREATEST(0, s.min_men - v_after_m) + GREATEST(0, s.min_women - v_after_f))
         <= v_slots_after;
END;
$$;

-- ============================================
-- Enforce it inside the pick
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
  v_gender TEXT;
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

  SELECT gender INTO v_gender FROM ptl_entries
   WHERE id = p_entry AND season_id = d.season_id AND status = 'confirmed';
  IF NOT FOUND THEN RAISE EXCEPTION 'PTL_ENTRY_NOT_AVAILABLE'; END IF;

  PERFORM 1 FROM ptl_roster WHERE season_id = d.season_id AND entry_id = p_entry;
  IF FOUND THEN RAISE EXCEPTION 'PTL_ENTRY_ALREADY_DRAFTED'; END IF;

  /*
   * A season that needs a gender balance cannot seat a player with no gender
   * recorded: they could not be assigned to a line. Caught here rather than on
   * match night, where the roster is already fixed.
   */
  IF (s.min_men > 0 OR s.min_women > 0) THEN
    IF v_gender IS NULL THEN RAISE EXCEPTION 'PTL_ENTRY_NO_GENDER'; END IF;
    IF NOT ptl_gender_allowed(p_team, v_gender) THEN
      RAISE EXCEPTION 'PTL_ROSTER_MINIMUM';
    END IF;
  END IF;

  INSERT INTO ptl_draft_picks(draft_id, pick_no, round_no, slot_no, team_id, entry_id, is_auto, made_by)
  VALUES (p_draft, d.current_pick_no, v_round, v_expected_slot, p_team, p_entry, p_auto, p_actor);

  INSERT INTO ptl_roster(season_id, team_id, entry_id, acquired, pick_no)
  VALUES (d.season_id, p_team, p_entry, 'draft', d.current_pick_no);

  -- A drafted player leaves EVERY captain's queue, not just the one who got
  -- them — otherwise other auto-picks would fire at a name that's gone.
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
-- Auto-pick has to respect it too
-- ============================================
-- Otherwise a captain who never opens the page gets a roster the rules forbid,
-- which is the worst possible way to discover the rule exists.
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

  IF d.status <> 'live'
     OR d.current_pick_no IS NULL
     OR d.current_deadline_at IS NULL
     OR NOW() < d.current_deadline_at THEN
    RETURN ptl_draft_state(p_draft);
  END IF;

  SELECT count(*) INTO v_n FROM ptl_teams WHERE season_id = d.season_id;
  SELECT id INTO v_team FROM ptl_teams
   WHERE season_id = d.season_id AND draft_slot = ptl_snake_slot(d.current_pick_no, v_n);

  -- Highest-ranked player on this captain's queue who is still available AND
  -- whom the roster minimums still permit.
  SELECT q.entry_id INTO v_entry
    FROM ptl_draft_queue q
    JOIN ptl_entries e ON e.id = q.entry_id AND e.status = 'confirmed'
   WHERE q.draft_id = p_draft
     AND q.team_id = v_team
     AND NOT EXISTS (
       SELECT 1 FROM ptl_roster r
        WHERE r.season_id = d.season_id AND r.entry_id = q.entry_id)
     AND ptl_gender_allowed(v_team, e.gender)
   ORDER BY q.rank ASC
   LIMIT 1;

  -- Empty or entirely blocked queue falls back to best available that fits.
  IF v_entry IS NULL THEN
    SELECT e.id INTO v_entry
      FROM ptl_entries e
     WHERE e.season_id = d.season_id
       AND e.status = 'confirmed'
       AND NOT EXISTS (
         SELECT 1 FROM ptl_roster r
          WHERE r.season_id = d.season_id AND r.entry_id = e.id)
       AND ptl_gender_allowed(v_team, e.gender)
     ORDER BY e.composite_score DESC NULLS LAST, e.created_at ASC
     LIMIT 1;
  END IF;

  IF v_entry IS NULL THEN RAISE EXCEPTION 'PTL_POOL_EMPTY'; END IF;

  RETURN ptl_make_pick(p_draft, v_team, v_entry, TRUE, 'autopick');
END;
$$;

-- Access, matching the other draft functions.
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'ptl_roster_needs(uuid)',
    'ptl_gender_allowed(uuid,text)',
    'ptl_make_pick(uuid,uuid,uuid,boolean,text)',
    'ptl_tick(uuid)'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
  END LOOP;
END $$;
