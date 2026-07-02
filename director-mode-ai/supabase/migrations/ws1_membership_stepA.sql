-- =====================================================================
-- WS1 · STEP A — Club membership + club_id backfill (ADDITIVE, non-breaking)
--
-- This adds the multi-tenant plumbing WITHOUT removing any existing access:
--   1. dedupe the two Sleepy Hollow clubs into one canonical club
--   2. ensure every user who owns data has a club + an 'owner' membership
--   3. add a nullable club_id to the user-scoped tables + backfill it
--   4. add a helper function for membership checks
--   5. add membership-based RLS policies ALONGSIDE the existing ones
--
-- Nothing here drops a policy or sets NOT NULL, so the app keeps working on
-- the current policies throughout. Tightening (Step C) happens later, after a
-- live pg_policies dump + verification.
--
-- Run in Supabase -> SQL editor. Re-runnable. Verify after each numbered block.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Dedupe the duplicate Sleepy Hollow clubs.
--    Canonical = the club actually referenced by CourtSheet courts, else the
--    earliest-created. Repoint memberships to it, then delete the loser.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  canonical uuid;
  dupe uuid;
BEGIN
  SELECT c.id INTO canonical
  FROM cc_clubs c
  LEFT JOIN (SELECT club_id, count(*) n FROM courts GROUP BY club_id) ct ON ct.club_id = c.id
  WHERE c.owner_id = '7ff5078a-ee6d-46b7-9af7-20b35f62729d'
  ORDER BY coalesce(ct.n,0) DESC, c.created_at ASC
  LIMIT 1;

  FOR dupe IN
    SELECT id FROM cc_clubs
    WHERE owner_id = '7ff5078a-ee6d-46b7-9af7-20b35f62729d' AND id <> canonical
  LOOP
    -- move any club-scoped rows off the dupe onto the canonical club
    UPDATE cc_club_members SET club_id = canonical WHERE club_id = dupe
      AND NOT EXISTS (SELECT 1 FROM cc_club_members m2 WHERE m2.club_id = canonical AND m2.user_id = cc_club_members.user_id);
    DELETE FROM cc_club_members WHERE club_id = dupe;
    UPDATE courts SET club_id = canonical WHERE club_id = dupe;
    UPDATE reservations SET club_id = canonical WHERE club_id = dupe;
    UPDATE reservation_series SET club_id = canonical WHERE club_id = dupe;
    UPDATE courtsheet_audit_log SET club_id = canonical WHERE club_id = dupe;
    DELETE FROM cc_clubs WHERE id = dupe;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 2. Every user who owns data must have a club + owner membership.
--    (covers e.g. the user who owns events but has no cc_clubs row.)
-- ---------------------------------------------------------------------
INSERT INTO cc_clubs (owner_id, name, slug, is_public)
SELECT DISTINCT p.id,
       COALESCE(NULLIF(p.organization_name, ''), NULLIF(p.full_name, ''), 'My Club'),
       'club-' || left(p.id::text, 8),
       false
FROM profiles p
WHERE NOT EXISTS (SELECT 1 FROM cc_clubs c WHERE c.owner_id = p.id)
  AND p.id IN (
    SELECT user_id      FROM events            WHERE user_id IS NOT NULL
    UNION SELECT director_id FROM leagues       WHERE director_id IS NOT NULL
    UNION SELECT profile_id  FROM lesson_coaches WHERE profile_id IS NOT NULL
    UNION SELECT user_id     FROM stringing_customers WHERE user_id IS NOT NULL
    UNION SELECT director_id FROM swim_seasons  WHERE director_id IS NOT NULL
  );

INSERT INTO cc_club_members (club_id, user_id, role)
SELECT c.id, c.owner_id, 'owner'
FROM cc_clubs c
WHERE NOT EXISTS (
  SELECT 1 FROM cc_club_members m WHERE m.club_id = c.id AND m.user_id = c.owner_id
);

-- ---------------------------------------------------------------------
-- 3. Add nullable club_id to the user-scoped tables + backfill from owner.
--    (Child tables inherit tenancy through their parent FK — no column needed.)
-- ---------------------------------------------------------------------
ALTER TABLE events              ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES cc_clubs(id);
ALTER TABLE leagues             ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES cc_clubs(id);
ALTER TABLE lesson_coaches      ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES cc_clubs(id);
ALTER TABLE stringing_customers ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES cc_clubs(id);
ALTER TABLE stringing_catalog   ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES cc_clubs(id);
ALTER TABLE swim_seasons        ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES cc_clubs(id);
ALTER TABLE players             ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES cc_clubs(id);

UPDATE events e             SET club_id = c.id FROM cc_clubs c WHERE c.owner_id = e.user_id       AND e.club_id  IS NULL;
UPDATE leagues l            SET club_id = c.id FROM cc_clubs c WHERE c.owner_id = l.director_id   AND l.club_id  IS NULL;
UPDATE lesson_coaches lc    SET club_id = c.id FROM cc_clubs c WHERE c.owner_id = lc.profile_id  AND lc.club_id IS NULL;
UPDATE stringing_customers s SET club_id = c.id FROM cc_clubs c WHERE c.owner_id = s.user_id     AND s.club_id  IS NULL;
UPDATE stringing_catalog s  SET club_id = c.id FROM cc_clubs c WHERE c.owner_id = s.user_id      AND s.club_id  IS NULL;
UPDATE swim_seasons se      SET club_id = c.id FROM cc_clubs c WHERE c.owner_id = se.director_id AND se.club_id IS NULL;
UPDATE players pl           SET club_id = c.id FROM cc_clubs c WHERE c.owner_id = pl.user_id     AND pl.club_id IS NULL;

-- ---------------------------------------------------------------------
-- 4. Membership helper (SECURITY DEFINER so RLS policies can call it).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_club_member(target_club uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT target_club IS NOT NULL AND EXISTS (
    SELECT 1 FROM cc_club_members m
    WHERE m.club_id = target_club AND m.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------
-- 5. Membership-based policies added ALONGSIDE existing ones (permissive =
--    OR-ed, so this only widens access; nothing breaks). Parent-scoped child
--    tables check their parent's club_id.
-- ---------------------------------------------------------------------
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "club members manage events" ON events;
CREATE POLICY "club members manage events" ON events
  FOR ALL TO authenticated
  USING (is_club_member(club_id)) WITH CHECK (is_club_member(club_id));

ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "club members manage leagues" ON leagues;
CREATE POLICY "club members manage leagues" ON leagues
  FOR ALL TO authenticated
  USING (is_club_member(club_id)) WITH CHECK (is_club_member(club_id));

ALTER TABLE stringing_customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "club members manage stringing customers" ON stringing_customers;
CREATE POLICY "club members manage stringing customers" ON stringing_customers
  FOR ALL TO authenticated
  USING (is_club_member(club_id) OR user_id = auth.uid())
  WITH CHECK (is_club_member(club_id) OR user_id = auth.uid());

-- (More tables — lessons, swim, tournaments/quads via parent — added in the
--  next wave once these three are verified against the app + the cc4401ed
--  isolation canary.)

-- =====================================================================
-- VERIFY (run as separate queries, expect the app to keep working):
--   select count(*) from events where club_id is null;      -- expect 0
--   select count(*) from cc_clubs;                            -- one per owner
--   select club_id, count(*) from cc_club_members group by 1;
-- =====================================================================
