-- ============================================
-- CourtSheet AI — Phase 1 / Migration 009
-- Seed: Sleepy Hollow Swim & Tennis Club + 8 courts.
-- ============================================
-- Dogfood club. Idempotent: safe to re-run.
--
-- Owner: darrinjco@gmail.com — resolved by email lookup against auth.users.
--
-- Operating hours: weekdays 6 AM – 10 PM; weekends 7 AM – 9 PM.
-- (Edit in the cc_clubs row or via the Settings UI once it ships.)
--
-- Courts: 8 outdoor hard courts numbered 1-8, tennis-only by default.
-- Re-label in the admin UI if any are pickleball-shared or have friendly
-- names like "Stadium".
-- ============================================

DO $$
DECLARE
  v_owner_id UUID;
  v_club_id  UUID;
BEGIN
  -- Resolve owner.
  SELECT id INTO v_owner_id
  FROM auth.users
  WHERE email = 'darrinjco@gmail.com'
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    RAISE NOTICE 'Sleepy Hollow seed skipped: no auth.users row for darrinjco@gmail.com';
    RETURN;
  END IF;

  -- Upsert the club.
  INSERT INTO cc_clubs (
    owner_id, name, slug, description,
    sports, is_public, timezone, operating_hours
  ) VALUES (
    v_owner_id,
    'Sleepy Hollow Swim & Tennis Club',
    'sleepy-hollow',
    'Private club in Orinda, CA. Founded 1955.',
    ARRAY['tennis']::TEXT[],
    true,
    'America/Los_Angeles',
    jsonb_build_object(
      '0', jsonb_build_array(jsonb_build_object('open','07:00','close','21:00')), -- Sun
      '1', jsonb_build_array(jsonb_build_object('open','06:00','close','22:00')), -- Mon
      '2', jsonb_build_array(jsonb_build_object('open','06:00','close','22:00')), -- Tue
      '3', jsonb_build_array(jsonb_build_object('open','06:00','close','22:00')), -- Wed
      '4', jsonb_build_array(jsonb_build_object('open','06:00','close','22:00')), -- Thu
      '5', jsonb_build_array(jsonb_build_object('open','06:00','close','22:00')), -- Fri
      '6', jsonb_build_array(jsonb_build_object('open','07:00','close','21:00'))  -- Sat
    )
  )
  ON CONFLICT (slug) DO UPDATE
    SET timezone = EXCLUDED.timezone,
        operating_hours = EXCLUDED.operating_hours
  RETURNING id INTO v_club_id;

  -- Owner membership (migration 002 also mirrors owners, but be explicit).
  INSERT INTO cc_club_members (club_id, user_id, role)
  VALUES (v_club_id, v_owner_id, 'owner')
  ON CONFLICT (club_id, user_id) DO UPDATE SET role = 'owner';

  -- 8 courts.
  INSERT INTO courts (club_id, number, sports, surface, indoor, display_order)
  SELECT v_club_id, n, ARRAY['tennis']::TEXT[], 'hard', false, n
  FROM generate_series(1, 8) AS n
  ON CONFLICT (club_id, number) DO NOTHING;
END $$;
