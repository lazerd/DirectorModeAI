-- lesson_slots was readable by anyone and writable by any signed-in user.
--
--   SELECT USING (true)                         -- every slot at every club
--   UPDATE USING (status='open')                -- claim any of them
--
-- Survivable while a slot held nothing but a time. Not survivable now that an
-- Open Lesson Time booking stores the client's name, email, phone and note on
-- the same row: any authenticated user could read who books lessons at any
-- club in ClubMode, and flip open slots anywhere.
--
-- The replacement keeps the one genuinely public case — an UNBOOKED slot, which
-- carries no personal data — and scopes everything else to the two people it
-- concerns. Booking now goes through service-role routes (/api/lessons/book and
-- /api/lessons/open), which is also where the coach-approval check moved.

DROP POLICY IF EXISTS "anyone views slots" ON lesson_slots;
DROP POLICY IF EXISTS "client books an open slot" ON lesson_slots;

-- An open slot advertises a time and nothing else. A booked one is private to
-- the coach who owns it and the client who booked it.
CREATE POLICY "open slots are public, booked ones are not" ON lesson_slots
  FOR SELECT
  USING (
    status IN ('open', 'available')
    OR EXISTS (
      SELECT 1 FROM lesson_coaches lc
      WHERE lc.id = lesson_slots.coach_id AND lc.profile_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM lesson_clients c
      WHERE c.id = lesson_slots.booked_by_client_id AND c.profile_id = auth.uid()
    )
  );

-- No client-side UPDATE policy on purpose: every booking path is server-side,
-- so the race, the approval check and the guest details are all settled where
-- they cannot be edited by the person doing the booking.
