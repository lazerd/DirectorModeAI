-- =====================================================================
-- WS1 · Lesson booking tables lockdown
-- Replaces the `auth_all_lesson_*` (any-authenticated read/write) holes with
-- scoped policies that PRESERVE the client-side booking flow:
--   client views a slot -> creates their own lesson_clients row -> updates the
--   open slot to 'booked'. Coaches manage their own slots/clients/blasts.
-- =====================================================================

-- lesson_slots: coach owns; anyone can view availability; a client can book an open slot.
DROP POLICY IF EXISTS "auth_all_lesson_slots" ON lesson_slots;
CREATE POLICY "coach manages own slots" ON lesson_slots FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM lesson_coaches lc WHERE lc.id = lesson_slots.coach_id AND lc.profile_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM lesson_coaches lc WHERE lc.id = lesson_slots.coach_id AND lc.profile_id = auth.uid()));
CREATE POLICY "anyone views slots" ON lesson_slots FOR SELECT USING (true);
CREATE POLICY "client books an open slot" ON lesson_slots FOR UPDATE TO authenticated
  USING (status = 'open') WITH CHECK (status = 'booked');

-- lesson_clients: the client manages their own record; their coach can read it.
DROP POLICY IF EXISTS "auth_all_lesson_clients" ON lesson_clients;
CREATE POLICY "client manages own record" ON lesson_clients FOR ALL TO authenticated
  USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());
CREATE POLICY "coach reads their clients" ON lesson_clients FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM lesson_client_coaches lcc
    JOIN lesson_coaches lc ON lc.id = lcc.coach_id
    WHERE lcc.client_id = lesson_clients.id AND lc.profile_id = auth.uid()
  ));

-- lesson_client_coaches: the client or the coach on the link may manage it.
DROP POLICY IF EXISTS "auth_all_lesson_client_coaches" ON lesson_client_coaches;
CREATE POLICY "client or coach manages link" ON lesson_client_coaches FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM lesson_clients c WHERE c.id = lesson_client_coaches.client_id AND c.profile_id = auth.uid())
    OR EXISTS (SELECT 1 FROM lesson_coaches lc WHERE lc.id = lesson_client_coaches.coach_id AND lc.profile_id = auth.uid())
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM lesson_clients c WHERE c.id = lesson_client_coaches.client_id AND c.profile_id = auth.uid())
    OR EXISTS (SELECT 1 FROM lesson_coaches lc WHERE lc.id = lesson_client_coaches.coach_id AND lc.profile_id = auth.uid())
  );

-- lesson_blasts: coach owns.
DROP POLICY IF EXISTS "auth_all_lesson_blasts" ON lesson_blasts;
CREATE POLICY "coach manages own blasts" ON lesson_blasts FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM lesson_coaches lc WHERE lc.id = lesson_blasts.coach_id AND lc.profile_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM lesson_coaches lc WHERE lc.id = lesson_blasts.coach_id AND lc.profile_id = auth.uid()));

-- lesson_blast_slots: scope via the parent blast's coach.
DROP POLICY IF EXISTS "auth_all_lesson_blast_slots" ON lesson_blast_slots;
CREATE POLICY "coach manages own blast slots" ON lesson_blast_slots FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM lesson_blasts b JOIN lesson_coaches lc ON lc.id = b.coach_id
    WHERE b.id = lesson_blast_slots.blast_id AND lc.profile_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM lesson_blasts b JOIN lesson_coaches lc ON lc.id = b.coach_id
    WHERE b.id = lesson_blast_slots.blast_id AND lc.profile_id = auth.uid()
  ));

-- lesson_client_profiles: the person owns their own profile row.
DROP POLICY IF EXISTS "auth_all_lesson_client_profiles" ON lesson_client_profiles;
CREATE POLICY "self manages client profile" ON lesson_client_profiles FOR ALL TO authenticated
  USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());
