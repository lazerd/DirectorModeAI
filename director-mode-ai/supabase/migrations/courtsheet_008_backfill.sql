-- ============================================
-- CourtSheet AI — Phase 1 / Migration 008
-- Future-only backfill scaffolding.
-- ============================================
-- Per the build decision (Q6), we do NOT historical-import existing
-- events into reservations. This file ships only the helper FUNCTIONS
-- that future Phase 3 tool adapters use, plus a no-op comment block
-- explaining the policy.
--
-- No data is moved by this migration.
--
-- The actual write-through wiring per tool ships in Phase 3:
--   - MixerMode: events → reservation on schedule/edit/cancel
--   - Quads:     quad_matches → reservation per match
--   - Tournaments: tournament_matches → reservation per match
--   - JTT:       league_team_matchups → reservation per matchup
--   - CourtConnect: cc_events → reservation, cc_event_players synced with
--                   reservation_signups
--   - LessonsMode: lesson_slots gets a court_id, then on-create writes a
--                   reservation
--
-- Safe to re-run.
-- ============================================

-- Helper: resolve a court label (e.g. '1', '5', 'Stadium') against a
-- club's courts table. Returns NULL if no match — adapters should treat
-- that as "skip this row, log a warning" rather than create a reservation
-- against the wrong court.
CREATE OR REPLACE FUNCTION courtsheet_resolve_court(
  p_club_id UUID,
  p_label   TEXT
) RETURNS UUID AS $$
DECLARE
  v_court_id UUID;
BEGIN
  -- Try match by name first (covers "Stadium", "Bubble", etc).
  SELECT id INTO v_court_id
  FROM courts
  WHERE club_id = p_club_id
    AND status <> 'hidden'
    AND name = p_label
  LIMIT 1;

  IF v_court_id IS NOT NULL THEN
    RETURN v_court_id;
  END IF;

  -- Fall back to numeric match ("1", "5", etc).
  BEGIN
    SELECT id INTO v_court_id
    FROM courts
    WHERE club_id = p_club_id
      AND status <> 'hidden'
      AND number = p_label::INT
    LIMIT 1;
  EXCEPTION
    WHEN invalid_text_representation THEN
      v_court_id := NULL;
  END;

  RETURN v_court_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper: idempotent reservation upsert for adapters. Adapters call this
-- with their tool's (source, source_id) pair and we either insert a new
-- reservation or update the existing one. Returns the reservation id.
CREATE OR REPLACE FUNCTION courtsheet_upsert_reservation(
  p_club_id     UUID,
  p_court_id    UUID,
  p_starts_at   TIMESTAMPTZ,
  p_ends_at     TIMESTAMPTZ,
  p_type        TEXT,
  p_source      TEXT,
  p_source_id   UUID,
  p_title       TEXT,
  p_created_by  UUID,
  p_meta        JSONB DEFAULT '{}'::jsonb
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Look for an existing reservation that came from this source row.
  SELECT id INTO v_id
  FROM reservations
  WHERE source = p_source
    AND source_id = p_source_id
    AND status <> 'cancelled'
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE reservations
       SET court_id   = p_court_id,
           starts_at  = p_starts_at,
           ends_at    = p_ends_at,
           type       = p_type,
           title      = p_title,
           meta       = p_meta,
           updated_at = NOW()
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO reservations (
    club_id, court_id, starts_at, ends_at,
    type, source, source_id, title, created_by, meta
  ) VALUES (
    p_club_id, p_court_id, p_starts_at, p_ends_at,
    p_type, p_source, p_source_id, p_title, p_created_by, p_meta
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION courtsheet_upsert_reservation IS
  'Idempotent reservation upsert keyed by (source, source_id). Phase 3 tool '
  'adapters call this. Raises on EXCLUDE-constraint conflict — adapters '
  'are expected to detect & report conflicts before calling.';
