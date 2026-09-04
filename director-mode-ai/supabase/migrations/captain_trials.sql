-- =====================================================================
-- A real 14-day CaptainMode trial.
--
-- getCaptainAccess has always treated 'trialing' as active, but nothing ever
-- created a trial and — more to the point — NOTHING EVER ENDED ONE. A row with
-- status 'trialing' granted CaptainMode free, forever. That was harmless while
-- no code path wrote the status; it stops being harmless the moment a signup
-- button does.
--
-- So the end date is a column, not a convention, and access is decided against
-- it. current_period_end is left alone: that belongs to the billing provider
-- and means "paid through", which is a different claim from "trial expires".
--
-- Run: node scripts/dbrun.mjs supabase/migrations/captain_trials.sql
-- Safe to re-run.
-- =====================================================================

ALTER TABLE captain_subscriptions
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_ends_at    TIMESTAMPTZ,
  -- Where this captain came from, so a season-opener email that turns into a
  -- signup can be told apart from someone who found the site on their own.
  -- Plain text, set once, never used for access.
  ADD COLUMN IF NOT EXISTS signup_source    TEXT;

-- A trial that somehow exists without an end date would be free forever, which
-- is the exact bug this migration is here to close. Backfill defensively.
UPDATE captain_subscriptions
   SET trial_ends_at = COALESCE(trial_ends_at, now() + interval '14 days'),
       trial_started_at = COALESCE(trial_started_at, created_at, now())
 WHERE status = 'trialing'
   AND trial_ends_at IS NULL;

ALTER TABLE captain_subscriptions DROP CONSTRAINT IF EXISTS captain_subscriptions_trial_dated;
ALTER TABLE captain_subscriptions
  ADD CONSTRAINT captain_subscriptions_trial_dated
  CHECK (status <> 'trialing' OR trial_ends_at IS NOT NULL);
