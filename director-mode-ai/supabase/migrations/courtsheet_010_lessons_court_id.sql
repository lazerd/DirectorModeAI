-- ============================================
-- CourtSheet AI — Phase 3 / Migration 010
-- lesson_slots.court_id (nullable FK).
-- ============================================
-- Lets a coach optionally pin a slot to a specific court. When set, the
-- lessons adapter (src/lib/courtsheet/adapters/lessons.ts) writes a
-- reservation for that court at slot creation time. When null, the slot
-- behaves exactly as it does today — no CourtSheet integration.
--
-- *** REVIEW BEFORE APPLYING — this migration ALTERS an existing live
--     table (lesson_slots). The new column is nullable with no default,
--     so existing rows are unaffected. ***
--
-- Safe to re-run.
-- ============================================

ALTER TABLE lesson_slots
  ADD COLUMN IF NOT EXISTS court_id UUID REFERENCES courts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lesson_slots_court ON lesson_slots(court_id)
  WHERE court_id IS NOT NULL;
