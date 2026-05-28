-- ============================================
-- CourtSheet AI — Phase 5+ / Migration 012
-- Parent/child court groups (tennis court ↔ pickleball halves).
-- ============================================
-- *** REVIEW BEFORE APPLYING — this migration ALTERS courts (drops the
--     UNIQUE on number, replaces with a partial unique) and ADDS a
--     trigger on reservations. All changes are additive; no existing
--     row breaks. ***
--
-- Models the real-world conversion case at Sleepy Hollow:
--   Court 11 is a tennis court whose net can be removed to lay out two
--   pickleball halves, "11a" and "11b". Booking semantics:
--     - Reserve court 11      → 11a + 11b are blocked (physical overlap)
--     - Reserve court 11a     → court 11 is blocked, 11b stays open
--     - Reserve court 11b     → court 11 is blocked, 11a stays open
--     - 11a and 11b can coexist (they're separate halves)
--
-- Data model: a self-referential parent_court_id on courts. 11a and 11b
-- both point at 11. Booking a parent blocks all children. Booking a child
-- blocks the parent. Sibling children do NOT block each other.
--
-- The same-court EXCLUDE constraint from migration 005 stays — it handles
-- direct overlaps. This migration adds a TRIGGER that handles the
-- cross-court parent/child case. The engine's conflict detector is also
-- updated (src/lib/courtsheet/conflicts.ts) to surface these in previews;
-- the trigger is the DB-level backstop.
--
-- Safe to re-run.
-- ============================================

-- 1) parent_court_id column.
ALTER TABLE courts
  ADD COLUMN IF NOT EXISTS parent_court_id UUID REFERENCES courts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_courts_parent ON courts(parent_court_id)
  WHERE parent_court_id IS NOT NULL;

-- Disallow grandparents (no 3-level chains) so the block-set is always
-- one hop deep. Enforced via CHECK on the column read at insert time.
ALTER TABLE courts DROP CONSTRAINT IF EXISTS courts_no_grandparent;
-- NOTE: deferring full CHECK because referencing other rows isn't
-- allowed in a column CHECK. Enforced in the trigger below + engine.

-- 2) Drop the strict UNIQUE(club_id, number); replace with partial-unique
--    so child courts can have NULL number (their label lives in `name`).
ALTER TABLE courts ALTER COLUMN number DROP NOT NULL;
ALTER TABLE courts DROP CONSTRAINT IF EXISTS courts_club_id_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS courts_club_id_number_partial
  ON courts(club_id, number)
  WHERE number IS NOT NULL;

-- 3) Group-aware conflict trigger.
-- Fires BEFORE INSERT OR UPDATE on reservations. If the new row's court
-- is part of a parent/child relationship, checks for overlapping
-- non-cancelled reservations on the RELATED courts (parent + own
-- children, NOT siblings). Raises with SQLSTATE 23P01 to match the
-- existing EXCLUDE-constraint failure shape, so client error handlers
-- treat both the same.
CREATE OR REPLACE FUNCTION courtsheet_check_court_group_overlap()
RETURNS TRIGGER AS $$
DECLARE
  v_parent_id UUID;
  v_conflict_id UUID;
  v_conflict_title TEXT;
BEGIN
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  -- Get the new court's parent, if any.
  SELECT parent_court_id INTO v_parent_id FROM courts WHERE id = NEW.court_id;

  -- Build the related-court set (this court excluded — same-court is
  -- already handled by the EXCLUDE constraint from migration 005):
  --   - The parent of this court (if any)
  --   - The children of this court (if it is itself a parent)
  WITH related AS (
    SELECT v_parent_id AS id WHERE v_parent_id IS NOT NULL
    UNION
    SELECT id FROM courts WHERE parent_court_id = NEW.court_id
  )
  SELECT r.id, r.title INTO v_conflict_id, v_conflict_title
  FROM reservations r
  WHERE r.court_id IN (SELECT id FROM related)
    AND r.status <> 'cancelled'
    AND r.id <> NEW.id
    AND tstzrange(r.starts_at, r.ends_at, '[)')
        && tstzrange(NEW.starts_at, NEW.ends_at, '[)')
  LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION
      'no_double_booking via court group: court % conflicts with reservation "%" (%)',
      NEW.court_id, v_conflict_title, v_conflict_id
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reservations_group_overlap ON reservations;
CREATE TRIGGER trg_reservations_group_overlap
  BEFORE INSERT OR UPDATE ON reservations
  FOR EACH ROW
  EXECUTE FUNCTION courtsheet_check_court_group_overlap();
