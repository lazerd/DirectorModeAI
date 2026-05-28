-- ============================================
-- CourtSheet AI — Phase 1 / Migration 004
-- `reservation_series` — the recurrence template.
-- ============================================
-- One series materializes into N concrete reservations across N
-- (court × date) combos. The series stores the intent (range, days-of-week,
-- time window, exclusions) in club-local terms; the engine expands it into
-- UTC reservations at write time so DST never warps a 9 AM clinic.
--
-- `intent` JSONB holds the structured booking intent that produced the
-- series (the same payload the AI agent emits). Keeping it around lets us
-- replay, audit, and rebuild instances if a series-wide edit lands.
--
-- Safe to re-run.
-- ============================================

CREATE TABLE IF NOT EXISTS reservation_series (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id       UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  type          TEXT NOT NULL
                  CHECK (type IN ('camp','lesson','event','match','member','maintenance','blackout','hold')),
  -- Date window in the CLUB'S TIMEZONE. Compute in local, store as DATE.
  range_start   DATE NOT NULL,
  range_end     DATE NOT NULL,
  -- Time window in CLUB-LOCAL time, no date.
  time_start    TIME NOT NULL,
  time_end      TIME NOT NULL,
  -- Days of week the series fires on. Postgres DOW: 0=Sun..6=Sat.
  -- An empty array means "every day in range" (single-day or all-days bookings).
  days_of_week  INT[] NOT NULL DEFAULT '{}',
  -- DATEs to skip (holidays, exceptions, etc).
  exclusions    DATE[] NOT NULL DEFAULT '{}',
  -- The full structured intent the agent emitted, kept for replay/audit.
  intent        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Free-form per-series metadata (coach_id, group name, color override, ...).
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by    UUID NOT NULL REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (range_end >= range_start),
  CHECK (time_end > time_start)
);

CREATE INDEX IF NOT EXISTS idx_reservation_series_club ON reservation_series(club_id, range_start, range_end);

CREATE OR REPLACE FUNCTION touch_reservation_series_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reservation_series_updated_at ON reservation_series;
CREATE TRIGGER trg_reservation_series_updated_at
  BEFORE UPDATE ON reservation_series
  FOR EACH ROW EXECUTE FUNCTION touch_reservation_series_updated_at();

ALTER TABLE reservation_series ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Club staff manage series" ON reservation_series;
CREATE POLICY "Club staff manage series" ON reservation_series
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = reservation_series.club_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner','director','coach','front_desk')
    )
  );

DROP POLICY IF EXISTS "Members read series" ON reservation_series;
CREATE POLICY "Members read series" ON reservation_series
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = reservation_series.club_id
        AND m.user_id = auth.uid()
    )
  );
