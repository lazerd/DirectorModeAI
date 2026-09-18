-- ============================================
-- DUPR — pickleball's rating, on the person and on the club roster.
-- ============================================
-- DUPR (dupr.com) is to pickleball what NTRP is to tennis, except it is a
-- computed rating rather than a self-assessment: roughly 2.000 to 8.000, to
-- THREE decimal places, separate numbers for singles and doubles.
--
-- Columns only. There is NO SYNC YET: reading a club's ratings from the
-- partner API (api.dupr.gg) needs DUPR partner approval, which is a
-- conversation, not a key. src/lib/levels/dupr.ts holds the shape the sync
-- would take. A director can type a rating in today, and that is worth having
-- on its own.
--
-- WHY NOT REUSE ntrp / usta_rating. Different scale, different precision,
-- different meaning of the same digits: a 4.0 NTRP and a 4.000 DUPR are not
-- the same player, and numeric(2,1) would round 3.412 to 3.4 and lose the
-- thing that makes DUPR worth having. Same reason WTN got its own columns.
--
-- Follows the conventions already here: master_players is the person (the hub,
-- see wtn_follows_the_player.sql), cc_vault_players is the club's copy.
--
-- Additive and safe to re-run.
-- ============================================

-- ---------------------------------------------------------------- the person
ALTER TABLE master_players ADD COLUMN IF NOT EXISTS dupr_id         TEXT;
ALTER TABLE master_players ADD COLUMN IF NOT EXISTS dupr_singles    NUMERIC(4,3);
ALTER TABLE master_players ADD COLUMN IF NOT EXISTS dupr_doubles    NUMERIC(4,3);
ALTER TABLE master_players ADD COLUMN IF NOT EXISTS dupr_updated_at TIMESTAMPTZ;

-- A band guard, the same idea as the WTN one: a number outside DUPR's range is
-- a mis-parse (a UTR, an NTRP, a jersey number), and a rating nobody checked
-- quietly sorts that player to the top or the bottom of every draw.
ALTER TABLE master_players DROP CONSTRAINT IF EXISTS master_players_dupr_singles_band_chk;
ALTER TABLE master_players ADD CONSTRAINT master_players_dupr_singles_band_chk
  CHECK (dupr_singles IS NULL OR (dupr_singles >= 2 AND dupr_singles <= 8));

ALTER TABLE master_players DROP CONSTRAINT IF EXISTS master_players_dupr_doubles_band_chk;
ALTER TABLE master_players ADD CONSTRAINT master_players_dupr_doubles_band_chk
  CHECK (dupr_doubles IS NULL OR (dupr_doubles >= 2 AND dupr_doubles <= 8));

-- The sync would look people up by their DUPR id, and two people may not share
-- one. Partial so the thousands of rows without one do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS master_players_dupr_id_key
  ON master_players (dupr_id) WHERE dupr_id IS NOT NULL;

-- ------------------------------------------------------------ the club's copy
ALTER TABLE cc_vault_players ADD COLUMN IF NOT EXISTS dupr_id         TEXT;
ALTER TABLE cc_vault_players ADD COLUMN IF NOT EXISTS dupr_singles    NUMERIC(4,3);
ALTER TABLE cc_vault_players ADD COLUMN IF NOT EXISTS dupr_doubles    NUMERIC(4,3);
ALTER TABLE cc_vault_players ADD COLUMN IF NOT EXISTS dupr_updated_at TIMESTAMPTZ;

ALTER TABLE cc_vault_players DROP CONSTRAINT IF EXISTS cc_vault_players_dupr_singles_band_chk;
ALTER TABLE cc_vault_players ADD CONSTRAINT cc_vault_players_dupr_singles_band_chk
  CHECK (dupr_singles IS NULL OR (dupr_singles >= 2 AND dupr_singles <= 8));

ALTER TABLE cc_vault_players DROP CONSTRAINT IF EXISTS cc_vault_players_dupr_doubles_band_chk;
ALTER TABLE cc_vault_players ADD CONSTRAINT cc_vault_players_dupr_doubles_band_chk
  CHECK (dupr_doubles IS NULL OR (dupr_doubles >= 2 AND dupr_doubles <= 8));
