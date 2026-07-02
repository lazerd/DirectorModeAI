-- =====================================================================
-- WS1 · Tenant isolation lockdown (authored against the LIVE pg_policies dump)
--
-- Closes the confirmed cross-tenant + anon-PII holes by scoping to the columns
-- that ALREADY exist (owner / director / user_id). Does NOT depend on the
-- membership migration — this is pure isolation. Public status-gated scoreboard
-- reads are preserved.
--
-- EXCLUDED here on purpose (own tested step): lesson_clients / lesson_slots /
-- lesson_blasts (booking flow), and the club-membership sharing model.
--
-- Run in Supabase -> SQL editor. Re-runnable. VERIFY each section after running.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. STRINGING — drop the wide-open "_all" policies; scope to the owner.
--    (stringing_customers already has "owner manages own" + anon revoked;
--     just remove the leftover open policy that still lets any authed user in.)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "stringing_customers_all" ON stringing_customers;

DROP POLICY IF EXISTS "stringing_jobs_all" ON stringing_jobs;
CREATE POLICY "owner manages stringing jobs" ON stringing_jobs
  FOR ALL TO authenticated
  USING (
    requested_by_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM stringing_customers c WHERE c.id = stringing_jobs.customer_id AND c.user_id = auth.uid())
  )
  WITH CHECK (
    requested_by_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM stringing_customers c WHERE c.id = stringing_jobs.customer_id AND c.user_id = auth.uid())
  );
REVOKE SELECT ON stringing_jobs FROM anon;

DROP POLICY IF EXISTS "stringing_rackets_all" ON stringing_rackets;
CREATE POLICY "owner manages stringing rackets" ON stringing_rackets
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM stringing_customers c WHERE c.id = stringing_rackets.customer_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM stringing_customers c WHERE c.id = stringing_rackets.customer_id AND c.user_id = auth.uid()));
REVOKE SELECT ON stringing_rackets FROM anon;

DROP POLICY IF EXISTS "stringing_catalog_all" ON stringing_catalog;
CREATE POLICY "owner manages stringing catalog" ON stringing_catalog
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
REVOKE SELECT ON stringing_catalog FROM anon;
-- VERIFY: /stringing/jobs, /stringing/customers, /stringing/catalog still load for you.

-- ---------------------------------------------------------------------
-- 2. LEAGUE TEAM TABLES — remove the any-authenticated "Coaches manage" holes.
--    Directors keep full access via the existing "Directors manage" policies;
--    coaches write via your service-role token endpoints (which bypass RLS);
--    the public status-gated read policies remain. So dropping these 4 closes
--    the cross-club read/write hole with no legitimate access lost.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Coaches manage lines"    ON league_matchup_lines;
DROP POLICY IF EXISTS "Coaches manage checkins" ON league_matchup_checkins;
DROP POLICY IF EXISTS "Coaches manage matchups" ON league_team_matchups;
DROP POLICY IF EXISTS "Coaches manage rosters"  ON league_team_rosters;
-- VERIFY: as the director, open a JTT league + a matchup page and confirm you
-- can still see/edit rosters, lineups, and check-ins. (Coach magic-link pages
-- use tokens and are unaffected.)

-- ---------------------------------------------------------------------
-- 3. league_team_rosters — stop exposing the magic-link token + parent PII to
--    anonymous visitors. Keep public roster NAMES + ratings visible by
--    restricting which COLUMNS anon may read.
-- ---------------------------------------------------------------------
REVOKE SELECT ON league_team_rosters FROM anon;
GRANT SELECT (
  id, division_id, club_id, player_name,
  ntrp, utr, utr_id, wtn, ladder_position, status, created_at, updated_at
) ON league_team_rosters TO anon;
-- VERIFY: public roster page /leagues/<slug>/rosters still shows player names.
--   If it errors, its query selects a now-blocked column — tell me and I'll
--   switch it to explicit safe columns.

-- ---------------------------------------------------------------------
-- 4. players — public scoreboards show NAMES; phone must not be public.
-- ---------------------------------------------------------------------
REVOKE SELECT ON players FROM anon;
GRANT SELECT (
  id, user_id, name, rating_notes, gender, linked_user_id, created_at,
  master_player_id, walkout_song_url, walkout_song_title, walkout_song_artist,
  walkout_song_start_seconds, walkout_announcer_audio_url
) ON players TO anon;
-- VERIFY: a public event scoreboard (/event/<code>) still shows player names.

-- ---------------------------------------------------------------------
-- 5. lesson_coaches — it's a public directory (names ok), but writeable by
--    anyone today and it leaks coach email to anon. Owner-only writes; anon
--    reads name/slug only.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "auth_all_lesson_coaches" ON lesson_coaches;
CREATE POLICY "coach manages own coach row" ON lesson_coaches
  FOR ALL TO authenticated
  USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());
CREATE POLICY "authenticated can read coach directory" ON lesson_coaches
  FOR SELECT TO authenticated USING (true);
REVOKE SELECT ON lesson_coaches FROM anon;
GRANT SELECT (id, profile_id, display_name, slug) ON lesson_coaches TO anon;
-- VERIFY: /find-coach and public coach pages /coach/<slug> still list coaches.

-- ---------------------------------------------------------------------
-- 6. cc_players / cc_player_sports / cc_invitations — remove "any authed user
--    sees everything". Scope to the player themselves; invitations to the
--    inviting club owner. (These feed CourtConnect.)
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "Auth users can view all players" ON cc_players;
CREATE POLICY "read own or same-org players" ON cc_players
  FOR SELECT TO authenticated
  USING (
    profile_id = auth.uid()
    OR EXISTS (SELECT 1 FROM cc_clubs c WHERE c.id = cc_players.organization_id AND c.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "Auth users can view sport ratings" ON cc_player_sports;
CREATE POLICY "read own player sport ratings" ON cc_player_sports
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM cc_players p WHERE p.id = cc_player_sports.player_id AND p.profile_id = auth.uid()));

DROP POLICY IF EXISTS "Auth users can manage invitations" ON cc_invitations;
-- (no replacement: invitations are created/read via server routes with the
--  service role; add a scoped policy later if a client path needs it.)
REVOKE SELECT ON cc_invitations FROM anon;

-- ---------------------------------------------------------------------
-- 7. event_photos — was fully open. Scope writes to the event owner; keep
--    public reads (photos are shown on public results cards / event pages).
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "event_photos_all" ON event_photos;
CREATE POLICY "owner manages event photos" ON event_photos
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_photos.event_id AND e.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM events e WHERE e.id = event_photos.event_id AND e.user_id = auth.uid()));
CREATE POLICY "public read event photos" ON event_photos
  FOR SELECT USING (true);

-- ---------------------------------------------------------------------
-- 8. LEGACY / DEAD open tables — the live app uses cc_clubs / lesson_* /
--    events / players, NOT these pre-rename leftovers. Remove their "everyone
--    can do everything" policies and cut public access. If any turns out to be
--    in use, its page will error and we re-scope it (reversible).
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  -- (mixer_* legacy tables are still referenced by admin/courtconnect routes,
  --  so they're intentionally left alone here — addressed separately.)
  FOREACH t IN ARRAY ARRAY[
    'clubs','coaches','clients','client_clubs','client_coaches','club_invitations',
    'email_blasts','event_participants','slots'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;
-- VERIFY: click around the live app (events, mixer, stringing, courtsheet,
-- lessons, leagues) — everything should work, since these are legacy tables.

-- =====================================================================
-- STILL TODO in a dedicated, tested step (NOT here):
--   - lesson_clients / lesson_slots / lesson_blasts (auth_all_* holes) — must
--     be closed without breaking booking; needs booking-flow testing.
--   - Multi-staff club sharing (club_id membership policies) — the enhancement
--     that lets admins/coaches share a director's data.
-- =====================================================================
