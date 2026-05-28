-- ============================================
-- CourtSheet AI — Phase 1 / Migration 005
-- `reservations` — the single source of truth for court time.
-- ============================================
-- *** REVIEW BEFORE APPLYING — this migration introduces the
--     no-double-booking EXCLUDE constraint. It depends on btree_gist from
--     migration 001. If 001 hasn't run, this fails. The constraint is the
--     entire reason CourtSheet's "the DB cannot be double-booked" promise
--     holds, so it's worth verifying it lands cleanly in prod. ***
--
-- One row = one atomic claim on one court for one [starts_at, ends_at)
-- range. Cancelled rows are excluded from the overlap check so freeing a
-- slot is a status change, not a delete.
--
-- `type`:    what is happening
-- `source`:  which subsystem created the row
-- `source_id`: FK into the originating tool's row (events.id, lesson_slots.id,
--              cc_events.id, quad_matches.id, etc.). Loosely typed UUID —
--              the source column tells you which table it points at.
-- `signups_open` + `signups_capacity`: opt-in surface for player/coach
--              "looking for N more" bookings. The signup join lives in
--              migration 006.
--
-- Safe to re-run.
-- ============================================

CREATE TABLE IF NOT EXISTS reservations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id       UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  court_id      UUID NOT NULL REFERENCES courts(id) ON DELETE RESTRICT,
  series_id     UUID REFERENCES reservation_series(id) ON DELETE SET NULL,

  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,

  type          TEXT NOT NULL
                  CHECK (type IN ('camp','lesson','event','match','member','maintenance','blackout','hold')),
  source        TEXT NOT NULL
                  CHECK (source IN ('manual','ai','lessons','mixer','courtconnect','tournaments','quads','jtt','import')),
  source_id     UUID,

  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'confirmed'
                  CHECK (status IN ('confirmed','tentative','cancelled')),
  color         TEXT,

  -- Opt-in: this reservation accepts player signups (clinic, doubles
  -- looking for 2 more, social, etc). Signup join in migration 006.
  signups_open      BOOLEAN NOT NULL DEFAULT false,
  signups_capacity  INT,
  -- Optional one-line cue the host wants signups to see
  -- ("Looking for 3 more for doubles", "Beginner clinic, all welcome").
  signups_pitch     TEXT,

  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_by    UUID NOT NULL REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (ends_at > starts_at),
  CHECK (signups_capacity IS NULL OR signups_capacity > 0)
);

-- The robustness linchpin.
-- Postgres rejects any INSERT/UPDATE that would put two non-cancelled
-- reservations on the same court with overlapping time ranges. Operates
-- at the data layer, so even a buggy application path can't double-book.
-- Requires btree_gist (migration 001).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'no_double_booking'
  ) THEN
    ALTER TABLE reservations
      ADD CONSTRAINT no_double_booking
      EXCLUDE USING gist (
        court_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
      ) WHERE (status <> 'cancelled');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reservations_club_time
  ON reservations(club_id, starts_at, ends_at)
  WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_reservations_court_time
  ON reservations(court_id, starts_at)
  WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_reservations_source
  ON reservations(source, source_id);
CREATE INDEX IF NOT EXISTS idx_reservations_series
  ON reservations(series_id) WHERE series_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reservations_signups_open
  ON reservations(club_id, starts_at)
  WHERE signups_open = true AND status = 'confirmed';

CREATE OR REPLACE FUNCTION touch_reservations_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reservations_updated_at ON reservations;
CREATE TRIGGER trg_reservations_updated_at
  BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION touch_reservations_updated_at();

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

-- Members of the club can read all non-cancelled reservations.
DROP POLICY IF EXISTS "Club members read reservations" ON reservations;
CREATE POLICY "Club members read reservations" ON reservations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = reservations.club_id
        AND m.user_id = auth.uid()
    )
  );

-- Public can read any reservation at a public club that's open for signups.
-- This drives the unauthenticated /courtsheet/[clubSlug] view.
DROP POLICY IF EXISTS "Public reads open-signup reservations" ON reservations;
CREATE POLICY "Public reads open-signup reservations" ON reservations
  FOR SELECT USING (
    signups_open = true
    AND status = 'confirmed'
    AND EXISTS (
      SELECT 1 FROM cc_clubs c
      WHERE c.id = reservations.club_id AND c.is_public = true
    )
  );

-- Staff (owner/director/coach/front_desk) manage reservations.
-- Coaches can write but only for their own reservations is enforced in
-- the engine, not RLS — keeping RLS simple here and treating the engine
-- as the authoritative gatekeeper for cross-staff edits.
DROP POLICY IF EXISTS "Staff manage reservations" ON reservations;
CREATE POLICY "Staff manage reservations" ON reservations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = reservations.club_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner','director','coach','front_desk')
    )
  );
