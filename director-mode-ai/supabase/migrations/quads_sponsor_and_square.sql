-- ============================================
-- Quads: sponsor branding + Square checkout
-- ============================================
-- 1. events.sponsor_id  — opt an event into a sponsor theme (src/config/sponsors.ts)
-- 2. events.venue       — human-readable venue line for the public page
-- 3. quad_entries.square_* — mirrors tournament_entries so the Square webhook
--    can mark a quad entry paid via order.reference_id (Stripe is unavailable).
--
-- Safe to re-run.
-- ============================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS sponsor_id TEXT,
  ADD COLUMN IF NOT EXISTS venue TEXT;

ALTER TABLE quad_entries
  ADD COLUMN IF NOT EXISTS square_order_id TEXT,
  ADD COLUMN IF NOT EXISTS square_payment_link_id TEXT;

CREATE INDEX IF NOT EXISTS idx_quad_entries_square_order
  ON quad_entries(square_order_id);
