-- Comping CaptainMode.
--
-- A director wants to give their own captains the product without charging
-- them. Before this the only way was to hand-write a row with status 'active',
-- which then looks exactly like a paying customer in every report and gives
-- nobody a way to tell why they have access.
--
-- 'comped' is its own status. It grants access (see ACTIVE_STATUSES in
-- src/lib/captain/access.ts) and records who gave it and why.

ALTER TABLE captain_subscriptions
  ADD COLUMN IF NOT EXISTS comp_note text,
  ADD COLUMN IF NOT EXISTS comped_by uuid,
  ADD COLUMN IF NOT EXISTS comped_at timestamptz;

COMMENT ON COLUMN captain_subscriptions.status IS
  'active | trialing | past_due | canceled | inactive | comped. "comped" is granted by a club '
  'owner/director through /api/captain/comp and is never written by the billing webhook.';
