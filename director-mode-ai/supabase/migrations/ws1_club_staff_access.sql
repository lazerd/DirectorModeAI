-- ============================================
-- One subscription, many logins — club staff can see the club's work
-- ============================================
-- Billing has been club-level for a while: resolveBillingUserId() in
-- src/lib/billing.ts maps any member of a club to that club's owner, so a
-- coach added to Sleepy Hollow already inherits the owner's Pro plan.
--
-- DATA access never followed. The core event tables are scoped to
-- `auth.uid() = user_id` — the person who CREATED the row — so a second
-- director or a teaching pro logged in with Pro access could see:
--
--   tournament entries ... 0    (can't see who's playing)
--   matches .............. 0    (can't enter a score)
--
-- i.e. they were paying for a platform they couldn't run an event on. Where
-- they could see events at all, it was an accident of the leftover
-- USING(true) read policies, not because they belong to the club.
--
-- This migration makes the core tables CLUB-scoped, which is what a director
-- means by "my staff should have access":
--
--   events              → any member of the owning club can read;
--                         owner/director can write
--   rounds, matches     → follow their event
--   tournament_entries  → follow their event
--   players             → club members can read their club's players
--
-- Additive on purpose. Existing creator-scoped policies stay, so nothing a
-- director can do today stops working; staff simply gain access alongside.
-- RLS is permissive — a row is visible if ANY policy allows it.
--
-- NOT done here: removing the USING(true) policies on events / players /
-- rounds. Those are a separate, riskier change because the public
-- /event/[eventCode] join page reads `events` with the browser anon key and
-- has to move server-side first. Tracked as WS1-followup.
--
-- Safe to re-run.
-- ============================================

-- --------------------------------------------
-- 0. Backfill club_id on events created before the column existed
-- --------------------------------------------
-- 7 of 22 rows had no club_id, and a club-membership policy can't match a
-- NULL. Attribute each to the club its creator owns.
UPDATE events e
SET club_id = c.id
FROM cc_clubs c
WHERE e.club_id IS NULL
  AND c.owner_id = e.user_id;

-- --------------------------------------------
-- 1. events
-- --------------------------------------------
DROP POLICY IF EXISTS club_staff_read_events ON events;
CREATE POLICY club_staff_read_events ON events FOR SELECT
  USING (club_id IS NOT NULL AND is_club_member(club_id));

DROP POLICY IF EXISTS club_staff_write_events ON events;
CREATE POLICY club_staff_write_events ON events FOR ALL
  USING (club_id IS NOT NULL AND is_club_staff(club_id))
  WITH CHECK (club_id IS NOT NULL AND is_club_staff(club_id));

-- --------------------------------------------
-- 2. rounds — follow the event
-- --------------------------------------------
DROP POLICY IF EXISTS club_staff_read_rounds ON rounds;
CREATE POLICY club_staff_read_rounds ON rounds FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = rounds.event_id AND e.club_id IS NOT NULL AND is_club_member(e.club_id)
  ));

DROP POLICY IF EXISTS club_staff_write_rounds ON rounds;
CREATE POLICY club_staff_write_rounds ON rounds FOR ALL
  USING (EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = rounds.event_id AND e.club_id IS NOT NULL AND is_club_staff(e.club_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = rounds.event_id AND e.club_id IS NOT NULL AND is_club_staff(e.club_id)
  ));

-- --------------------------------------------
-- 3. matches — two hops: match → round → event
-- --------------------------------------------
DROP POLICY IF EXISTS club_staff_read_matches ON matches;
CREATE POLICY club_staff_read_matches ON matches FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM rounds r
    JOIN events e ON e.id = r.event_id
    WHERE r.id = matches.round_id AND e.club_id IS NOT NULL AND is_club_member(e.club_id)
  ));

-- Coaches score matches; that's the whole point of giving them a login.
DROP POLICY IF EXISTS club_staff_write_matches ON matches;
CREATE POLICY club_staff_write_matches ON matches FOR ALL
  USING (EXISTS (
    SELECT 1 FROM rounds r
    JOIN events e ON e.id = r.event_id
    WHERE r.id = matches.round_id AND e.club_id IS NOT NULL AND is_club_member(e.club_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM rounds r
    JOIN events e ON e.id = r.event_id
    WHERE r.id = matches.round_id AND e.club_id IS NOT NULL AND is_club_member(e.club_id)
  ));

-- --------------------------------------------
-- 4. tournament_entries — follow the event
-- --------------------------------------------
-- Read is club-wide (a pro running the desk needs the entry list); writes stay
-- with owner/director, since entries carry contact details and payment state.
DROP POLICY IF EXISTS club_staff_read_entries ON tournament_entries;
CREATE POLICY club_staff_read_entries ON tournament_entries FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = tournament_entries.event_id AND e.club_id IS NOT NULL AND is_club_member(e.club_id)
  ));

DROP POLICY IF EXISTS club_staff_write_entries ON tournament_entries;
CREATE POLICY club_staff_write_entries ON tournament_entries FOR ALL
  USING (EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = tournament_entries.event_id AND e.club_id IS NOT NULL AND is_club_staff(e.club_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM events e
    WHERE e.id = tournament_entries.event_id AND e.club_id IS NOT NULL AND is_club_staff(e.club_id)
  ));

-- --------------------------------------------
-- 5. players — already has club_id
-- --------------------------------------------
DROP POLICY IF EXISTS club_staff_read_players ON players;
CREATE POLICY club_staff_read_players ON players FOR SELECT
  USING (club_id IS NOT NULL AND is_club_member(club_id));

DROP POLICY IF EXISTS club_staff_write_players ON players;
CREATE POLICY club_staff_write_players ON players FOR ALL
  USING (club_id IS NOT NULL AND is_club_staff(club_id))
  WITH CHECK (club_id IS NOT NULL AND is_club_staff(club_id));

-- --------------------------------------------
-- 6. leagues — director_id only, same blind spot
-- --------------------------------------------
DROP POLICY IF EXISTS club_staff_read_leagues ON leagues;
CREATE POLICY club_staff_read_leagues ON leagues FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM cc_clubs c
    WHERE c.owner_id = leagues.director_id AND is_club_member(c.id)
  ));
