-- ============================================
-- Quads: age divisions, event series, and request → invite → pay entry flow
-- ============================================
-- Motivation: the Dunkin' Junior Quads runs two dates, each with three age
-- divisions (10U / 12U / 13&O) sharing one 2-hour block of courts. Players
-- register free; the director accepts them once he can see which divisions
-- actually filled, and only then does a payment link go out with a deadline.
--
-- New concepts:
--   events.series_slug  — groups the dates so one URL can offer both
--   events.divisions    — JSONB list of age divisions for this event
--   events.entry_flow   — 'pay_now' (existing behaviour) | 'request_then_invite'
--   events.total_quads  — how many groups-of-4 the block has room for
--   quad_entries.division / invited_at / payment_due_at / payment_url
--
-- Safe to re-run.
-- ============================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS series_slug TEXT,
  ADD COLUMN IF NOT EXISTS end_time TIME,
  ADD COLUMN IF NOT EXISTS divisions JSONB,
  ADD COLUMN IF NOT EXISTS total_quads INTEGER,
  ADD COLUMN IF NOT EXISTS entry_flow TEXT NOT NULL DEFAULT 'pay_now'
    CHECK (entry_flow IN ('pay_now', 'request_then_invite'));

CREATE INDEX IF NOT EXISTS idx_events_series_slug ON events(series_slug);

ALTER TABLE quad_entries
  ADD COLUMN IF NOT EXISTS division TEXT,
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_url TEXT;

CREATE INDEX IF NOT EXISTS idx_quad_entries_division ON quad_entries(event_id, division);
CREATE INDEX IF NOT EXISTS idx_quad_entries_payment_due ON quad_entries(payment_due_at)
  WHERE payment_due_at IS NOT NULL;

-- position gains two states:
--   'requested' — signed up, waiting on the director's accept
--   'expired'   — was invited but didn't pay inside the window
ALTER TABLE quad_entries DROP CONSTRAINT IF EXISTS quad_entries_position_check;
ALTER TABLE quad_entries ADD CONSTRAINT quad_entries_position_check
  CHECK (position IN (
    'requested',
    'pending_payment',
    'in_flight',
    'waitlist',
    'withdrawn',
    'expired'
  ));
