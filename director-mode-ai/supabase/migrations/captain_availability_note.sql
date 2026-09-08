-- =====================================================================
-- The qualifier attached to an availability answer.
--
-- yes / no / maybe does not cover what players actually reply. A real poll
-- from a real captain, imported 2026-09-08, carried three answers the schema
-- had nowhere to put:
--
--   "Doubles only"        — Susie Chao, on four separate matches
--   "First shift only"    — Caedmon Patalano
--   "Call last"           — Jennifer Walker
--
-- All three are a YES with a condition. Flattening them to a bare 'yes' loses
-- the exact detail a captain needs when building that match's lineup, and
-- flattening them to 'maybe' is worse — it reads as uncertainty when the player
-- was being precise. So the status stays a clean tri-state and the words the
-- player used are kept beside it.
--
-- Deliberately free text: these qualifiers are whatever a player types, and an
-- enum would have to guess the categories in advance and would drop the rest.
--
-- Run: node scripts/dbrun.mjs supabase/migrations/captain_availability_note.sql
-- Safe to re-run.
-- =====================================================================

ALTER TABLE captain_availability
  ADD COLUMN IF NOT EXISTS note TEXT;

COMMENT ON COLUMN captain_availability.note IS
  'Player''s own qualifier on the answer — "doubles only", "call last", "can''t stay past noon". Shown to the captain beside the status.';
