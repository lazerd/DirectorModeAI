-- The club hub was one global room.
--
-- club_hub_messages had no club_id at all and a policy of
-- `SELECT USING (true)` for any authenticated user — so 102 messages of one
-- club's internal conversation were readable by anyone with an account at any
-- club, and a second club's chat would have landed in the same room.
--
-- Give the messages a club, put the existing ones where they came from, and
-- scope reads and writes to that club's people.

ALTER TABLE club_hub_messages ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES cc_clubs(id) ON DELETE CASCADE;

-- Everything written so far came from the only club using the hub.
UPDATE club_hub_messages
   SET club_id = (SELECT id FROM cc_clubs WHERE slug = 'sleepy-hollow')
 WHERE club_id IS NULL;

CREATE INDEX IF NOT EXISTS club_hub_messages_club_idx ON club_hub_messages (club_id, created_at DESC);

DROP POLICY IF EXISTS "authed can read hub" ON club_hub_messages;
DROP POLICY IF EXISTS "authed insert own human msg" ON club_hub_messages;

-- Read: the club's own people, and nobody else.
CREATE POLICY "club people read their hub" ON club_hub_messages
  FOR SELECT TO authenticated
  USING (
    club_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = club_hub_messages.club_id AND m.user_id = auth.uid()
    )
  );

-- Write: as yourself, into your own club's room.
CREATE POLICY "club people post to their hub" ON club_hub_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND is_persona IS NOT TRUE
    AND club_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = club_hub_messages.club_id AND m.user_id = auth.uid()
    )
  );
