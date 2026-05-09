-- ============================================
-- Freemium Rollout v1
-- - Two-tier pricing: Free + Pro $29/mo
-- - $9 Day Pass per-event unlock
-- - Plan tiers, Stripe linkage, monthly usage credits
-- - Walkout-song fields on mixer_players (DJ Console)
-- - Free DJ Console = 1 event lifetime (tracked on profiles.free_dj_event_id)
-- - Backfills all existing users to a 90-day grandfathered Pro trial
-- ============================================

-- 1) Plan state on profiles
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS plan_tier TEXT DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT,
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grandfathered_trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS free_dj_event_id UUID;

-- Drop and re-add CHECK so re-running this migration is safe.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_plan_tier_check;
ALTER TABLE profiles
  ADD CONSTRAINT profiles_plan_tier_check
  CHECK (plan_tier IN ('free','pro','grandfathered'));

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer ON profiles(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_profiles_stripe_subscription ON profiles(stripe_subscription_id);

-- 2) Monthly usage credits — one row per user, reset at month rollover
CREATE TABLE IF NOT EXISTS usage_credits (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', NOW()),
  emails_used INT NOT NULL DEFAULT 0,
  sms_used INT NOT NULL DEFAULT 0,
  sms_overage_cents INT NOT NULL DEFAULT 0,
  tts_chars_used INT NOT NULL DEFAULT 0,
  ai_calls_used INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) Day Pass: per-event unlocks of paid features for free users
ALTER TABLE mixer_events
  ADD COLUMN IF NOT EXISTS day_pass_purchased_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS day_pass_stripe_session_id TEXT;

-- 4) Walkout songs on mixer_players (DJ Console)
ALTER TABLE mixer_players
  ADD COLUMN IF NOT EXISTS walkout_song_url TEXT,
  ADD COLUMN IF NOT EXISTS walkout_song_title TEXT,
  ADD COLUMN IF NOT EXISTS walkout_song_artist TEXT,
  ADD COLUMN IF NOT EXISTS walkout_song_start_seconds INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS walkout_announcer_audio_url TEXT;

-- 5) Phone + SMS opt-in on mixer_players (Phase 3 prep)
ALTER TABLE mixer_players
  ADD COLUMN IF NOT EXISTS sms_opt_in BOOLEAN NOT NULL DEFAULT false;

-- 6) Billing audit log
CREATE TABLE IF NOT EXISTS billing_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  stripe_event_id TEXT UNIQUE,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_billing_events_user ON billing_events(user_id);

-- 7) Grandfather all existing users → 90 days of Pro access on launch
-- Idempotent: only flips users still on 'free' (won't overwrite anyone we already set)
UPDATE profiles
SET plan_tier = 'grandfathered',
    grandfathered_trial_ends_at = NOW() + INTERVAL '90 days'
WHERE plan_tier = 'free'
  AND grandfathered_trial_ends_at IS NULL;

-- 8) Seed usage_credits for everyone so consumeCredits never has to upsert
INSERT INTO usage_credits (user_id)
SELECT id FROM profiles
ON CONFLICT (user_id) DO NOTHING;
