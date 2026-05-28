-- ============================================
-- CourtSheet AI — Phase 5+ / Migration 013
-- Sleepy Hollow seed correction — 11 courts + pickleball split.
-- ============================================
-- Sleepy Hollow actually has 11 courts. Court 11 doubles as two
-- pickleball halves "11a" and "11b" (modeled as child courts via
-- parent_court_id from migration 012).
--
-- Adds courts 9, 10, 11 (regular tennis) + 11a, 11b (pickleball children)
-- to the Sleepy Hollow club seeded in migration 009. Idempotent.
--
-- Safe to re-run.
-- ============================================

DO $$
DECLARE
  v_club_id UUID;
  v_court_11_id UUID;
BEGIN
  SELECT id INTO v_club_id FROM cc_clubs WHERE slug = 'sleepy-hollow' LIMIT 1;
  IF v_club_id IS NULL THEN
    RAISE NOTICE '013_seed_full skipped: Sleepy Hollow club not found (run 009 first)';
    RETURN;
  END IF;

  -- Courts 9 and 10 — regular tennis.
  INSERT INTO courts (club_id, number, sports, surface, indoor, display_order)
  VALUES
    (v_club_id, 9,  ARRAY['tennis']::TEXT[], 'hard', false, 9),
    (v_club_id, 10, ARRAY['tennis']::TEXT[], 'hard', false, 10)
  ON CONFLICT (club_id, number) DO NOTHING;

  -- Court 11 — parent court (tennis).
  INSERT INTO courts (club_id, number, sports, surface, indoor, display_order)
  VALUES
    (v_club_id, 11, ARRAY['tennis','pickleball']::TEXT[], 'hard', false, 11)
  ON CONFLICT (club_id, number) DO NOTHING;

  SELECT id INTO v_court_11_id
  FROM courts
  WHERE club_id = v_club_id AND number = 11
  LIMIT 1;

  -- Courts 11a and 11b — pickleball halves, children of court 11.
  -- Number is NULL (partial-unique from 012 allows this); name carries
  -- the label.
  INSERT INTO courts (club_id, number, name, sports, surface, indoor, display_order, parent_court_id)
  SELECT v_club_id, NULL, '11a', ARRAY['pickleball']::TEXT[], 'hard', false, 111, v_court_11_id
  WHERE NOT EXISTS (
    SELECT 1 FROM courts
    WHERE club_id = v_club_id AND name = '11a'
  );

  INSERT INTO courts (club_id, number, name, sports, surface, indoor, display_order, parent_court_id)
  SELECT v_club_id, NULL, '11b', ARRAY['pickleball']::TEXT[], 'hard', false, 112, v_court_11_id
  WHERE NOT EXISTS (
    SELECT 1 FROM courts
    WHERE club_id = v_club_id AND name = '11b'
  );
END $$;
