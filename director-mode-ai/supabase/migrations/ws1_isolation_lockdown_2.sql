-- WS1 follow-up isolation, applied + verified via RLS simulation.
--
-- 1. league_team_rosters: scope the public-view policy to ANON only. Previously
--    it was TO public (anon + authenticated), so any logged-in user could read
--    every club's rosters. Anon column grants already hide player_token +
--    parent PII; the director reads their own via "Directors manage rosters";
--    the JTT token flows use the service role. Verified: random authed user
--    now sees 0 rows.
drop policy if exists "Public can view rosters" on league_team_rosters;
create policy "Public can view rosters" on league_team_rosters for select to anon
  using (exists (select 1 from league_divisions d join leagues l on l.id=d.league_id
                 where d.id=league_team_rosters.division_id and l.status = any (array['running','completed'])));

-- 2. events.stripe_account_id: assessed. Cannot column-lock without breaking the
--    public event pages (they select('*')) or the payment register routes.
--    events metadata (name/date/code/fee + non-secret Connect acct id) is
--    intentionally public-by-code, same as the public scoreboards. No PII, no
--    secrets. Documented as accepted; full metadata privacy is a post-launch
--    public-view refactor if ever desired.
