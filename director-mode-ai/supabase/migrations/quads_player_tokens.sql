-- ============================================
-- Per-player scoring token for Quads tournaments
-- ============================================
-- Each entry gets a unique token so a player can open ONE link and see
-- all their matches (singles + R4 doubles) in one place. Replaces the
-- previous per-match-token UX where players had to track 4 separate URLs.
--
-- Per-match score_token on quad_matches stays in place — it's still used
-- as the underlying credential for /api/quads/match/[token] POSTs.
-- The player page just renders all of a player's match tokens together.
--
-- Safe to re-run.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE quad_entries
  ADD COLUMN IF NOT EXISTS player_token TEXT;

UPDATE quad_entries
SET player_token = replace(uuid_generate_v4()::text, '-', '')
WHERE player_token IS NULL;

ALTER TABLE quad_entries
  ALTER COLUMN player_token SET NOT NULL;

ALTER TABLE quad_entries
  ALTER COLUMN player_token SET DEFAULT replace(uuid_generate_v4()::text, '-', '');

DROP INDEX IF EXISTS idx_quad_entries_player_token;
CREATE UNIQUE INDEX idx_quad_entries_player_token ON quad_entries(player_token);
