-- ============================================
-- JTT roster tokens — magic-link roster entry for coaches
-- ============================================
-- Adds a URL-safe token to every club so coaches can open
-- /leagues/roster/[token] and manage their own roster without
-- logging in. Same pattern as league_matchup_lines.score_token.
--
-- Safe to re-run. Apply after leagues_jtt.sql.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Per-club roster management token (unique, indexed)
ALTER TABLE league_clubs
  ADD COLUMN IF NOT EXISTS roster_token TEXT;

-- Backfill existing rows with new tokens
UPDATE league_clubs
SET roster_token = replace(uuid_generate_v4()::text, '-', '')
WHERE roster_token IS NULL;

-- Enforce non-null + unique going forward
ALTER TABLE league_clubs
  ALTER COLUMN roster_token SET NOT NULL;

DROP INDEX IF EXISTS idx_clubs_roster_token;
CREATE UNIQUE INDEX idx_clubs_roster_token ON league_clubs(roster_token);

-- Default for future inserts so clients can omit the field
ALTER TABLE league_clubs
  ALTER COLUMN roster_token SET DEFAULT replace(uuid_generate_v4()::text, '-', '');
