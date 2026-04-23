-- ============================================
-- JTT score tokens — magic-link scoring for team-format lines
-- ============================================
-- Adds a URL-safe token to every line so a parent/coach can open
-- /leagues/line/[token] and enter the score without logging in.
--
-- Safe to re-run. Apply after leagues_jtt.sql.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Per-line scoring token (unique, indexed)
ALTER TABLE league_matchup_lines
  ADD COLUMN IF NOT EXISTS score_token TEXT;

-- Backfill existing rows with new tokens
UPDATE league_matchup_lines
SET score_token = replace(uuid_generate_v4()::text, '-', '')
WHERE score_token IS NULL;

-- Enforce non-null + unique going forward
ALTER TABLE league_matchup_lines
  ALTER COLUMN score_token SET NOT NULL;

DROP INDEX IF EXISTS idx_lines_score_token;
CREATE UNIQUE INDEX idx_lines_score_token ON league_matchup_lines(score_token);

-- Default for future inserts so clients can omit the field
ALTER TABLE league_matchup_lines
  ALTER COLUMN score_token SET DEFAULT replace(uuid_generate_v4()::text, '-', '');
