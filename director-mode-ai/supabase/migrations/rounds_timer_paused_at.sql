-- Pause/reset state for the round-timer — persisted so admin Pause/Reset affect
-- the public countdown, and the timer survives page reload. NULL means running.
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS timer_paused_at TIMESTAMPTZ;
