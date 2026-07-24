-- ============================================
-- The staff boundary: "directors and pros", not "everyone who joined"
-- ============================================
-- ws1_club_staff_access.sql opened the core event tables to
-- is_club_member(), which is TRUE for any row in cc_club_members — including
-- role='member', which is what /api/clubs/join assigns to anyone who follows
-- the club's public invite link. That is the membership, i.e. players.
--
-- So that policy would have shown every player at the club the full entry
-- list, contact details included. Wrong boundary, and exactly the leak just
-- closed on the public side, re-opened from the inside.
--
-- The existing helpers don't fit either:
--   is_club_member(club) → owner, director, coach, front_desk, member  (too wide)
--   is_club_staff(club)  → owner, director                             (too narrow — excludes the pros)
--
-- Add the one that matches what a director means by "my team".
--
-- Safe to re-run.
-- ============================================

CREATE OR REPLACE FUNCTION public.is_club_team(target_club uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT target_club IS NOT NULL AND EXISTS (
    SELECT 1 FROM cc_club_members m
    WHERE m.club_id = target_club
      AND m.user_id = auth.uid()
      AND m.role IN ('owner', 'director', 'coach', 'front_desk')
  );
$$;

COMMENT ON FUNCTION public.is_club_team(uuid) IS
  'Staff of a club: owner, director, coach, front_desk. Excludes role=member, '
  'which is what the public join link grants. Use this for anything carrying '
  'member contact details or event administration.';

-- --------------------------------------------
-- Re-point every policy added by ws1_club_staff_access
-- --------------------------------------------

DROP POLICY IF EXISTS club_staff_read_events ON events;
CREATE POLICY club_staff_read_events ON events FOR SELECT
  USING (club_id IS NOT NULL AND is_club_team(club_id));

DROP POLICY IF EXISTS club_staff_read_rounds ON rounds;
CREATE POLICY club_staff_read_rounds ON rounds FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = rounds.event_id AND e.club_id IS NOT NULL AND is_club_team(e.club_id)
  ));

DROP POLICY IF EXISTS club_staff_write_rounds ON rounds;
CREATE POLICY club_staff_write_rounds ON rounds FOR ALL
  USING (EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = rounds.event_id AND e.club_id IS NOT NULL AND is_club_team(e.club_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = rounds.event_id AND e.club_id IS NOT NULL AND is_club_team(e.club_id)
  ));

DROP POLICY IF EXISTS club_staff_read_matches ON matches;
CREATE POLICY club_staff_read_matches ON matches FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM rounds r
    JOIN events e ON e.id = r.event_id
    WHERE r.id = matches.round_id AND e.club_id IS NOT NULL AND is_club_team(e.club_id)
  ));

DROP POLICY IF EXISTS club_staff_write_matches ON matches;
CREATE POLICY club_staff_write_matches ON matches FOR ALL
  USING (EXISTS (
    SELECT 1 FROM rounds r
    JOIN events e ON e.id = r.event_id
    WHERE r.id = matches.round_id AND e.club_id IS NOT NULL AND is_club_team(e.club_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM rounds r
    JOIN events e ON e.id = r.event_id
    WHERE r.id = matches.round_id AND e.club_id IS NOT NULL AND is_club_team(e.club_id)
  ));

DROP POLICY IF EXISTS club_staff_read_entries ON tournament_entries;
CREATE POLICY club_staff_read_entries ON tournament_entries FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = tournament_entries.event_id AND e.club_id IS NOT NULL AND is_club_team(e.club_id)
  ));

DROP POLICY IF EXISTS club_staff_read_players ON players;
CREATE POLICY club_staff_read_players ON players FOR SELECT
  USING (club_id IS NOT NULL AND is_club_team(club_id));

DROP POLICY IF EXISTS club_staff_read_leagues ON leagues;
CREATE POLICY club_staff_read_leagues ON leagues FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM cc_clubs c
    WHERE c.owner_id = leagues.director_id AND is_club_team(c.id)
  ));
