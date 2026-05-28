-- ============================================
-- CourtSheet AI — Phase 1 / Migration 003
-- The `courts` table — the bookable units.
-- ============================================
-- A court is a physical surface that can be reserved. Distinct from the
-- per-event `events.court_names TEXT[]` arrays used by Quads/Tournaments
-- today — those become labels that resolve into court_id once a club's
-- courts are seeded. The court_names arrays are preserved unchanged.
--
-- `number` is the user-facing index ("Court 1") and is what the AI parses
-- when a director says "courts 1 through 6". Uniqueness is per-club.
--
-- Safe to re-run.
-- ============================================

CREATE TABLE IF NOT EXISTS courts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id       UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  number        INT  NOT NULL,
  name          TEXT,
  sports        TEXT[] NOT NULL DEFAULT '{tennis}',
  surface       TEXT,
  indoor        BOOLEAN NOT NULL DEFAULT false,
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','maintenance','hidden')),
  display_order INT  NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (club_id, number)
);

CREATE INDEX IF NOT EXISTS idx_courts_club_display ON courts(club_id, display_order, number);
CREATE INDEX IF NOT EXISTS idx_courts_club_status ON courts(club_id, status);

CREATE OR REPLACE FUNCTION touch_courts_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_courts_updated_at ON courts;
CREATE TRIGGER trg_courts_updated_at
  BEFORE UPDATE ON courts
  FOR EACH ROW EXECUTE FUNCTION touch_courts_updated_at();

ALTER TABLE courts ENABLE ROW LEVEL SECURITY;

-- Members can read their club's courts (drives the public member view).
DROP POLICY IF EXISTS "Club members can read courts" ON courts;
CREATE POLICY "Club members can read courts" ON courts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = courts.club_id
        AND m.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM cc_clubs c
      WHERE c.id = courts.club_id AND c.is_public = true
    )
  );

-- Owners + directors + front_desk write courts. Coaches read-only.
DROP POLICY IF EXISTS "Staff manage courts" ON courts;
CREATE POLICY "Staff manage courts" ON courts
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = courts.club_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner','director','front_desk')
    )
  );
