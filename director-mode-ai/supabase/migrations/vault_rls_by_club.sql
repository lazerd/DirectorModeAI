-- The club's roster is the CLUB's, not the private property of whoever typed it.
--
-- cc_vault_players had one policy: `director_id = auth.uid()`. Read it for what
-- it says -- a roster row is visible only to the single account that entered
-- it. Two consequences, both wrong now that a row names its club:
--
--   * A director, coach or front desk who is not the person who did the import
--     opens PlayerVault and sees an empty club. Every demo club is in exactly
--     this shape: the rows were entered by a demo director account, and the
--     club is owned by someone else.
--   * An owner who runs two clubs passed the check for BOTH clubs' rows at
--     once, because the test never mentioned a club. That is the same hole
--     vault_belongs_to_a_club.sql closed in the queries; leaving it open in the
--     policy means the only thing standing between Rossmoor and Sleepy
--     Hollow's roster is application code remembering to filter.
--
-- Club staff manage their own club's roster. is_club_team() is the established
-- staff test (owner, director, coach, front desk) and is what every other
-- club-scoped policy uses.
--
-- The director_id fallback is kept for rows that have no club yet -- a row
-- entered by someone who runs no club, which the backfill deliberately left
-- alone rather than guessing. It cannot leak a club's roster, because a row
-- with a club is answered by the club test.
--
-- Safe to re-run.

ALTER TABLE cc_vault_players ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Directors can manage own vault" ON cc_vault_players;
DROP POLICY IF EXISTS "Club staff manage the club roster" ON cc_vault_players;

CREATE POLICY "Club staff manage the club roster" ON cc_vault_players
  FOR ALL
  USING (
    is_club_team(club_id)
    OR (club_id IS NULL AND director_id = auth.uid())
  )
  WITH CHECK (
    is_club_team(club_id)
    OR (club_id IS NULL AND director_id = auth.uid())
  );
