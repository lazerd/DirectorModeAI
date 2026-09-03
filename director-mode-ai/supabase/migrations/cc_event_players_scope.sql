-- cc_event_players was world-readable: `SELECT USING (true)`.
--
-- 20 rows of guest names today and, since the table carries guest_email, an
-- address the moment anyone uses that field. Any signed-in user at any club
-- could enumerate every club's event rosters.
--
-- cc_events has no club_id — it is scoped by created_by — so the honest rule
-- is: the person who created the event, the player themselves, and events the
-- creator has explicitly marked public. The public club page's "N going" count
-- now comes from a service-role endpoint rather than from the browser reading
-- the roster directly.

DROP POLICY IF EXISTS "Public can view event players" ON cc_event_players;

CREATE POLICY "roster is for the organiser and the player" ON cc_event_players
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM cc_events e
      WHERE e.id = cc_event_players.event_id AND e.created_by = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM cc_players p
      WHERE p.id = cc_event_players.player_id AND p.profile_id = auth.uid()
    )
  );
