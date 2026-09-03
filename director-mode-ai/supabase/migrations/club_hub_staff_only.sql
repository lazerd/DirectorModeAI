-- Correction to club_hub_tenant_scope.sql.
--
-- The club hub is INTENTIONALLY cross-club — "the one shared space", where
-- directors from different clubs talk to each other. Scoping it per club was
-- wrong and is reverted here.
--
-- What was genuinely wrong is narrower: the policy said "any authenticated
-- user", while the room is for DIRECTORS. A member who joined a club with a
-- join code, or anyone who signed up at all, could read it. Staff of some club
-- is the honest expression of the intent.
--
-- club_id stays on the row as provenance (who said it, from where) but is no
-- longer used to gate reads.

DROP POLICY IF EXISTS "club people read their hub" ON club_hub_messages;
DROP POLICY IF EXISTS "club people post to their hub" ON club_hub_messages;

CREATE POLICY "club staff read the hub" ON club_hub_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.user_id = auth.uid()
        AND m.role IN ('owner','director','coach','front_desk')
    )
    OR EXISTS (SELECT 1 FROM cc_clubs c WHERE c.owner_id = auth.uid())
  );

CREATE POLICY "club staff post to the hub" ON club_hub_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND is_persona IS NOT TRUE
    AND (
      EXISTS (
        SELECT 1 FROM cc_club_members m
        WHERE m.user_id = auth.uid()
          AND m.role IN ('owner','director','coach','front_desk')
      )
      OR EXISTS (SELECT 1 FROM cc_clubs c WHERE c.owner_id = auth.uid())
    )
  );
