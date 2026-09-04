-- =====================================================================
-- A second contact per player, and the team's own people.
--
-- Junior teams broke the one-email-per-player assumption twice over:
--   * A child's contact IS a parent's, and there are usually two of them —
--     one travels for work, one is at the match. Storing one means the lineup
--     email reaches whoever happened to be typed in first.
--   * A team has adults who are not on the roster: a coach, a co-captain, a
--     team parent. They need every match email, and they never will be players.
--
-- Neither belongs in captain_players.email, and a second player row per child
-- would corrupt the roster, the lineup and every fairness count that reads it.
--
-- Run: node scripts/dbrun.mjs supabase/migrations/captain_extra_contacts.sql
-- Safe to re-run.
-- =====================================================================

ALTER TABLE captain_players
  ADD COLUMN IF NOT EXISTS contact2_name  TEXT,
  ADD COLUMN IF NOT EXISTS contact2_email TEXT,
  ADD COLUMN IF NOT EXISTS contact2_phone TEXT;

COMMENT ON COLUMN captain_players.contact2_email IS
  'Second parent/guardian. Copied on everything the first contact gets.';

-- ---------------------------------------------------------------------
-- Adults attached to the team who are not players.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS captain_team_contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES captain_teams(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'other'
                CHECK (role IN ('coach', 'captain', 'co_captain', 'team_parent', 'other')),
  email       TEXT,
  phone       TEXT,
  -- Whether this person is copied on what goes to the team. Off by default:
  -- adding someone to a list should never silently start mailing them.
  on_emails   BOOLEAN NOT NULL DEFAULT false,
  notes       TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, name, role)
);
CREATE INDEX IF NOT EXISTS idx_captain_team_contacts_team ON captain_team_contacts(team_id);

ALTER TABLE captain_team_contacts ENABLE ROW LEVEL SECURITY;

-- The same boundary as every other captain table: this team's staff only.
DROP POLICY IF EXISTS captain_team_contacts_rw ON captain_team_contacts;
CREATE POLICY captain_team_contacts_rw ON captain_team_contacts
  FOR ALL TO authenticated
  USING (public.captain_can_access_team(team_id))
  WITH CHECK (public.captain_can_access_team(team_id));
