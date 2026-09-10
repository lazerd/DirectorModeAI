-- ============================================================================
-- 20260910_launch_lockdown.sql
--
-- Close the world-readable token / PII tables before launch.
--
-- !! APPLY ONLY AFTER the fix/security branch is deployed. !!
-- That branch moves the last visitor-facing read (/leagues/[slug]/rosters) off
-- the cookie client onto getSupabaseAdmin(). Every other public page and token
-- route already reads these tables with the service role, which RLS does not
-- touch.
--
-- Verified against production 2026-09-10 (SELECT-only):
--   * Each table below has a "Directors manage ..." FOR ALL policy, so the
--     owning director keeps full access.
--   * anon holds SELECT only on quad_entries and leagues; the other four were
--     already closed to logged-out visitors and leaked only to signed-in users
--     (i.e. every other director after launch).
--   * No other table's policy and no view references these tables.
--   * There are NO "Coaches manage ..." policies in prod — coaches work through
--     the roster_token / score_token routes (service role), unaffected.
-- ============================================================================

begin;

-- 1. Drop the permissive "Public can view ..." SELECT policies. -------------
--    quad_entries carries DOB + parent email/phone; the rest carry the
--    roster_token / score_token write credentials.
drop policy if exists "Public can view quad entries"       on public.quad_entries;
drop policy if exists "Public can view league clubs"       on public.league_clubs;
drop policy if exists "Public can view lines"              on public.league_matchup_lines;
drop policy if exists "Public can view tournament matches" on public.tournament_matches;
drop policy if exists "Public can view quad matches"       on public.quad_matches;

-- 2. Keep club staff (owner/director/coach/front_desk) reading. -------------
--    Until now a club's coaches saw these rows only through the public
--    policies. Mirror the existing staff boundary exactly:
--      leagues            -> club_staff_read_leagues  (cc_clubs.owner_id = director_id)
--      events / entries   -> club_staff_read_events / club_staff_read_entries (events.club_id)
--    is_club_team() excludes role='member', so players do not get PII.
drop policy if exists "club_staff_read_league_clubs" on public.league_clubs;
create policy "club_staff_read_league_clubs" on public.league_clubs
  for select to authenticated
  using (exists (
    select 1
      from leagues l
      join cc_clubs c on c.owner_id = l.director_id
     where l.id = league_clubs.league_id
       and is_club_team(c.id)
  ));

drop policy if exists "club_staff_read_lines" on public.league_matchup_lines;
create policy "club_staff_read_lines" on public.league_matchup_lines
  for select to authenticated
  using (exists (
    select 1
      from league_team_matchups m
      join league_divisions d on d.id = m.division_id
      join leagues l on l.id = d.league_id
      join cc_clubs c on c.owner_id = l.director_id
     where m.id = league_matchup_lines.matchup_id
       and is_club_team(c.id)
  ));

drop policy if exists "club_staff_read_quad_entries" on public.quad_entries;
create policy "club_staff_read_quad_entries" on public.quad_entries
  for select to authenticated
  using (exists (
    select 1
      from events e
     where e.id = quad_entries.event_id
       and e.club_id is not null
       and is_club_team(e.club_id)
  ));

drop policy if exists "club_staff_read_quad_matches" on public.quad_matches;
create policy "club_staff_read_quad_matches" on public.quad_matches
  for select to authenticated
  using (exists (
    select 1
      from quad_flights f
      join events e on e.id = f.event_id
     where f.id = quad_matches.flight_id
       and e.club_id is not null
       and is_club_team(e.club_id)
  ));

drop policy if exists "club_staff_read_tournament_matches" on public.tournament_matches;
create policy "club_staff_read_tournament_matches" on public.tournament_matches
  for select to authenticated
  using (exists (
    select 1
      from events e
     where e.id = tournament_matches.event_id
       and e.club_id is not null
       and is_club_team(e.club_id)
  ));

-- 3. leagues.jtt_email_recipients (coach email list; set on all 7 leagues). --
--    A column-level REVOKE is a no-op while a table-level grant exists, so
--    swap anon's table-level SELECT for a column list that omits it.
--    Safe for anon: no code reads `leagues` with select('*') using the anon
--    key (public league pages use getSupabaseAdmin; the one cookie-client page
--    is converted in fix/security and names its columns). RLS policies that
--    reference leagues (id, status, director_id) keep working — those columns
--    stay granted.
--    NOTE: a column added to `leagues` later is NOT visible to anon until it is
--    added to this grant.
revoke select on public.leagues from anon;
grant select (
  id, director_id, name, slug, description, start_date, end_date,
  registration_opens_at, registration_closes_at, status,
  venmo_handle, zelle_handle, stripe_payment_link,
  created_at, updated_at, league_type, format,
  rsvp_confirmation_lead_hours, club_id
) on public.leagues to anon;

--    NOT DONE for `authenticated`: the director JTT pages
--    (mixer/leagues/[id]/page.tsx, mixer/leagues/[id]/jtt/page.tsx) read
--    `leagues` with select('*') as the signed-in user, and a column list would
--    break them. Any signed-in user can therefore still read
--    jtt_email_recipients of a published league via "Public can view published
--    leagues". Proper fix (post-launch): move the list to its own table with no
--    policies (service-role only), as was done for event_score_tokens.

commit;
