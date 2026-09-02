-- ============================================
-- Quads: stretch capacity + a second wave
-- ============================================
-- A quads block can hold more groups than we commit to up front. The event
-- opens with `total_quads` (what we promise) and can grow to `max_total_quads`
-- as the waitlist justifies it, optionally spilling into a second time wave.
--
--   total_quads      — quads currently open. The allocator seats against this.
--   max_total_quads  — ceiling we could stretch to if demand shows up.
--   wave2_*          — the second 2-hour window, used once wave 1 is full.
--
-- Each PLAYER still gets one fixed 2-hour window; the waves exist so we can say
-- yes to more families without making anyone hang around for four hours.
--
-- Safe to re-run.
-- ============================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS max_total_quads INTEGER,
  ADD COLUMN IF NOT EXISTS wave2_start_time TIME,
  ADD COLUMN IF NOT EXISTS wave2_end_time TIME;

-- Which wave a confirmed player is assigned to (1 or 2). NULL until assigned.
ALTER TABLE quad_entries
  ADD COLUMN IF NOT EXISTS wave INTEGER CHECK (wave IS NULL OR wave BETWEEN 1 AND 2);

ALTER TABLE quad_flights
  ADD COLUMN IF NOT EXISTS wave INTEGER CHECK (wave IS NULL OR wave BETWEEN 1 AND 2);
