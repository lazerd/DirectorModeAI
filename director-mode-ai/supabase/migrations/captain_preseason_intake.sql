-- =====================================================================
-- CaptainMode — pre-season intake
--
-- Players fill in their own partner preferences, return side, court limit
-- and recurring day blackouts once before the season, instead of the captain
-- guessing or typing it all in. Everything lands in tables the lineup
-- generator already reads (captain_partner_prefs, captain_players).
--
-- Two new columns only; nothing is dropped or rewritten.
-- Idempotent: safe to run repeatedly.
-- =====================================================================

alter table captain_players
  add column if not exists unavailable_days text[] not null default '{}';

alter table captain_players
  add column if not exists intake_completed_at timestamptz;

comment on column captain_players.unavailable_days is
  'Recurring weekday blackouts from the pre-season intake, e.g. {Mon,Thu}. Advisory: shown to the captain, never a hard filter.';
comment on column captain_players.intake_completed_at is
  'When this player submitted the pre-season intake. Null = never responded, which is what the reminder targets.';

-- The player writes these through the tokenised, login-free surface, which
-- runs as the service role. anon must stay locked out exactly as before.
revoke all on captain_players from anon;
revoke all on captain_partner_prefs from anon;

-- =====================================================================
-- VERIFY:
--   select column_name, data_type, column_default from information_schema.columns
--    where table_name='captain_players' and column_name in ('unavailable_days','intake_completed_at');
--   -- anon must return zero rows:
--   select table_name, privilege_type from information_schema.role_table_grants
--    where grantee='anon' and table_name in ('captain_players','captain_partner_prefs');
-- =====================================================================
