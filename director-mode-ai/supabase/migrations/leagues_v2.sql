-- ============================================
-- Leagues v2 — league types + manual seeding
-- ============================================
-- Adds support for Round Robin and Single Elimination formats alongside
-- the original Compass Draw, plus a manual seed override so directors
-- can reorder entries before generating draws.
--
-- Safe to re-run. Run after the original leagues.sql migration.
-- ============================================

-- Add league_type column (default preserves existing rows as 'compass')
ALTER TABLE leagues
  ADD COLUMN IF NOT EXISTS league_type TEXT NOT NULL DEFAULT 'compass'
  CHECK (league_type IN ('compass','round_robin','single_elimination'));

CREATE INDEX IF NOT EXISTS idx_leagues_type ON leagues(league_type);

-- Add manual_seed column to entries. NULL = no override, use composite_score.
ALTER TABLE league_entries
  ADD COLUMN IF NOT EXISTS manual_seed INTEGER;

-- Flights can now hold arbitrary sizes for round robin (not just 8 or 16).
-- Drop the old size CHECK constraint and replace with a permissive one.
ALTER TABLE league_flights
  DROP CONSTRAINT IF EXISTS league_flights_size_check;
ALTER TABLE league_flights
  ADD CONSTRAINT league_flights_size_check
  CHECK (size BETWEEN 2 AND 64);

-- Round robin flights run all rounds in parallel (not sequentially), so
-- num_rounds can be anywhere from 1 up. Loosen that too.
ALTER TABLE league_flights
  DROP CONSTRAINT IF EXISTS league_flights_num_rounds_check;
ALTER TABLE league_flights
  ADD CONSTRAINT league_flights_num_rounds_check
  CHECK (num_rounds BETWEEN 1 AND 16);

-- Round number on matches currently caps at 4 (compass). Loosen for larger formats.
ALTER TABLE league_matches
  DROP CONSTRAINT IF EXISTS league_matches_round_check;
ALTER TABLE league_matches
  ADD CONSTRAINT league_matches_round_check
  CHECK (round BETWEEN 1 AND 16);
