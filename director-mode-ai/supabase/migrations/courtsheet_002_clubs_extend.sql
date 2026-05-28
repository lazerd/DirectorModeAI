-- ============================================
-- CourtSheet AI — Phase 1 / Migration 002
-- Extend cc_clubs into the CourtSheet club entity + members join.
-- ============================================
-- *** REVIEW BEFORE APPLYING — this migration ALTERS an existing live table
--     (cc_clubs). All adds are nullable-or-defaulted so no existing row
--     breaks, but please eyeball it before running in the SQL editor. ***
--
-- Adds to cc_clubs:
--   - timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles'
--       The club's wall-clock timezone. ALL recurrence math runs in this
--       TZ so a 9 AM clinic stays 9 AM across DST transitions.
--   - operating_hours JSONB NOT NULL DEFAULT '{}'
--       Per-day-of-week open/close windows. Shape:
--         { "0": null,                                  -- Sunday closed
--           "1": [{"open":"06:00","close":"22:00"}],    -- Mon–Fri 6–10
--           ...
--           "6": [{"open":"07:00","close":"21:00"}] }   -- Saturday
--       Null/missing day = closed. Multiple windows allowed (split hours).
--       Empty {} = no constraint (legacy clubs, treated as 24/7).
--
-- New table cc_club_members:
--   The membership join that decides who can read/write a club's sheet.
--   Role-scoped: owner has full control, director nearly so, coach can
--   manage their own bookings, front_desk can read+create but not destroy,
--   member is the player-side view (read-only public surface).
--
-- Safe to re-run.
-- ============================================

ALTER TABLE cc_clubs
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  ADD COLUMN IF NOT EXISTS operating_hours JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS cc_club_members (
  club_id    UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member'
              CHECK (role IN ('owner','director','coach','front_desk','member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (club_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_cc_club_members_user ON cc_club_members(user_id);
CREATE INDEX IF NOT EXISTS idx_cc_club_members_club_role ON cc_club_members(club_id, role);

ALTER TABLE cc_club_members ENABLE ROW LEVEL SECURITY;

-- Owners + directors manage membership.
DROP POLICY IF EXISTS "Owners and directors manage memberships" ON cc_club_members;
CREATE POLICY "Owners and directors manage memberships" ON cc_club_members
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = cc_club_members.club_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner','director')
    )
    OR EXISTS (
      SELECT 1 FROM cc_clubs c
      WHERE c.id = cc_club_members.club_id
        AND c.owner_id = auth.uid()
    )
  );

-- Members can see who else is in their club.
DROP POLICY IF EXISTS "Members can view club roster" ON cc_club_members;
CREATE POLICY "Members can view club roster" ON cc_club_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = cc_club_members.club_id
        AND m.user_id = auth.uid()
    )
  );

-- Mirror cc_clubs.owner_id into cc_club_members so the membership check is
-- the single source of truth. Idempotent: only inserts owners not already
-- present as members.
INSERT INTO cc_club_members (club_id, user_id, role)
SELECT id, owner_id, 'owner'
FROM cc_clubs
ON CONFLICT (club_id, user_id) DO NOTHING;
