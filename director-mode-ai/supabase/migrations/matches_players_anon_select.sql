-- Public event-code pages (/event/[code]) are unauthenticated, but matches and
-- players were RLS-locked so anon got back empty arrays — leaving the player
-- view with round headers but no match cards. Open SELECT to anon: all event
-- data is already exposed via the event_code URL, this just lets Postgres
-- serve the joined rows.
CREATE POLICY IF NOT EXISTS matches_anon_select ON matches FOR SELECT TO anon USING (true);
CREATE POLICY IF NOT EXISTS players_anon_select ON players FOR SELECT TO anon USING (true);
