-- ============================================
-- Freemium v2: apply DJ Console + Day Pass schema to V1 (live) tables
-- ============================================
-- freemium_001 added columns to mixer_events / mixer_players which are
-- 0-row v2 tables. The actual mixer events live in `events` and players
-- in `players`. This migration adds the same columns to v1.

-- Day Pass per-event unlock
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS day_pass_purchased_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS day_pass_stripe_session_id TEXT,
  ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_during_trial BOOLEAN NOT NULL DEFAULT false;

-- Walkout songs + SMS opt-in on players
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS walkout_song_url TEXT,
  ADD COLUMN IF NOT EXISTS walkout_song_title TEXT,
  ADD COLUMN IF NOT EXISTS walkout_song_artist TEXT,
  ADD COLUMN IF NOT EXISTS walkout_song_start_seconds INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS walkout_announcer_audio_url TEXT,
  ADD COLUMN IF NOT EXISTS sms_opt_in BOOLEAN NOT NULL DEFAULT false;
