-- =====================================================================
-- CaptainMode — captaining style, schedule lead times, manual strength rank
--
-- Three things the generator and the cron already want but had nowhere to
-- read from:
--
--   captain_teams.captaining_style  'play_to_win' | 'equal_play'
--       equal_play is a HARD tier gate on matches played (see lineup.ts
--       equalPlayPool) — not a scoring weight, because a weight gets
--       outvoted by partner-preference points and someone ends up on 5
--       matches while a teammate sits on 2.
--   captain_teams.poll_lead_days    when the FIRST availability ask goes out
--   captain_teams.lineup_lead_days  when the lineup email goes out
--       Both were hardcoded constants in /api/captain/cron. Defaults match
--       the previous behaviour for lineups (7); 21 is the new initial poll,
--       which had no automation at all before.
--   captain_players.sort_order      captain's own strength ranking, 1 =
--       strongest. Overrides rating when set, because NTRP is coarse — half
--       a roster shares a 3.5 — and a captain who has watched these people
--       play knows things the number doesn't. Null falls back to rating.
--   captain_matches.availability_poll_sent_at
--       the *_sent_at guard for the new initial poll, so a cron re-run can
--       never double-send.
--
-- Additive only; nothing is dropped or rewritten. Idempotent.
-- =====================================================================

alter table captain_teams
  add column if not exists captaining_style text not null default 'play_to_win';

alter table captain_teams
  add column if not exists poll_lead_days integer not null default 21;

alter table captain_teams
  add column if not exists lineup_lead_days integer not null default 7;

alter table captain_players
  add column if not exists sort_order integer;

alter table captain_matches
  add column if not exists availability_poll_sent_at timestamptz;

-- Constraints added separately so a re-run doesn't error on an existing one.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'captain_teams_captaining_style_chk'
  ) then
    alter table captain_teams
      add constraint captain_teams_captaining_style_chk
      check (captaining_style in ('play_to_win', 'equal_play'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'captain_teams_lead_days_chk'
  ) then
    -- A lineup can't be published before the poll goes out, and neither can
    -- sit further out than a season. Guards a typo in the settings form.
    alter table captain_teams
      add constraint captain_teams_lead_days_chk
      check (
        poll_lead_days between 1 and 120
        and lineup_lead_days between 1 and 120
        and lineup_lead_days <= poll_lead_days
      );
  end if;
end $$;

comment on column captain_teams.captaining_style is
  'play_to_win = strongest available side each week, fairness a mild tiebreaker. equal_play = hard tier gate on matches played, keeps max-minus-min <= 1 across the season even when it benches a stronger player.';
comment on column captain_teams.poll_lead_days is
  'Days before a match that the FIRST availability ask is emailed. Read by /api/captain/cron.';
comment on column captain_teams.lineup_lead_days is
  'Days before a match that the lineup email goes out. Read by /api/captain/cron.';
comment on column captain_players.sort_order is
  'Captain''s manual strength rank, 1 = strongest. Overrides rating in the lineup generator when set; null sorts below every ranked player.';
comment on column captain_matches.availability_poll_sent_at is
  'When the initial availability blast went out. Guard so a cron re-run never double-sends.';

-- unavailable_days is no longer advisory: it is now a real constraint in the
-- generator (an explicit per-match "yes" still overrides it) and it suppresses
-- poll/nudge email for a day the player already said they can never play.
comment on column captain_players.unavailable_days is
  'Recurring weekday blackouts from the pre-season intake, e.g. {Mon,Thu}. A real constraint: the generator drops these players for a match on that weekday and warns why, unless the player explicitly answered yes to that specific match. Also suppresses poll/nudge email for that match.';

-- These columns are captain-facing only; anon must stay locked out exactly as
-- before (precedent: ws1_isolation_lockdown.sql).
revoke all on captain_teams from anon;
revoke all on captain_players from anon;
revoke all on captain_matches from anon;

-- =====================================================================
-- VERIFY:
--   select column_name, data_type, column_default from information_schema.columns
--    where (table_name='captain_teams'
--             and column_name in ('captaining_style','poll_lead_days','lineup_lead_days'))
--       or (table_name='captain_players'  and column_name='sort_order')
--       or (table_name='captain_matches'  and column_name='availability_poll_sent_at');
--   -- expect 5 rows
--
--   -- anon must return zero rows:
--   select table_name, privilege_type from information_schema.role_table_grants
--    where grantee='anon'
--      and table_name in ('captain_teams','captain_players','captain_matches');
-- =====================================================================
