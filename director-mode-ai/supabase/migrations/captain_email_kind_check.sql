-- Let captains save settings / per-match exceptions for the new 'check' kind.
--
-- Widens the kind CHECK on the two timeline tables; no rows are written, so no
-- team's sends change. Without this, turning the availability check on from
-- the timeline page fails the constraint.
ALTER TABLE captain_email_settings DROP CONSTRAINT IF EXISTS captain_email_settings_kind_check;
ALTER TABLE captain_email_settings
  ADD CONSTRAINT captain_email_settings_kind_check
  CHECK (kind IN ('poll','check','nudge','lineup','reminder'));

ALTER TABLE captain_email_overrides DROP CONSTRAINT IF EXISTS captain_email_overrides_kind_check;
ALTER TABLE captain_email_overrides
  ADD CONSTRAINT captain_email_overrides_kind_check
  CHECK (kind IN ('poll','check','nudge','lineup','reminder'));
