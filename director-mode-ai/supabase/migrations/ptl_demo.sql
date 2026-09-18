-- ============================================
-- PTL — demo seasons
-- ============================================
-- A link the NorCal sub-committee can open and poke at as if they were being
-- sold to: a full season already populated, a real draft room they can pick
-- in, standings that add up. Nothing they do may touch a real season, and
-- nothing may email a real person.
--
-- WHY THIS IS ONE COLUMN AND NOT A SUBSYSTEM
--
-- The existing demo machinery (demo_links, lib/demo/*) signs a visitor into a
-- real account inside a club tenant, because the rest of ClubMode is scoped by
-- club. PTL has no clubs and no player accounts — every table hangs off
-- ptl_seasons. So a demo season is already a sealed universe: its own teams,
-- its own pool, its own draft, its own nights. Marking the season is the whole
-- isolation story.
--
-- THE EMAIL RULE
--
-- Two independent guards, because this is the one that can embarrass us in
-- front of the people we are pitching:
--
--   1. Every seeded demo player has an @example.com address, and
--      lib/demo/emailGuard.ts suppresses those FIRST, before any database
--      lookup, so the hold survives even a dead database.
--   2. The enrolment route refuses to send at all when the season is_demo —
--      so a committee member who types their own real address into the demo
--      form still gets nothing. Address-based suppression alone would have
--      mailed them.
--
-- reset_seed lets the whole season be rebuilt from scratch after a visitor has
-- drafted all over it, so the second person to open the link sees what the
-- first one did.
--
-- Safe to re-run.
-- ============================================

ALTER TABLE ptl_seasons
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

-- Free-text note shown in the demo banner ("Sample season — built for the
-- USTA NorCal 5.0+ sub-committee").
ALTER TABLE ptl_seasons
  ADD COLUMN IF NOT EXISTS demo_note TEXT;

-- Which demo scenario this season was seeded as, so the reset script knows how
-- to rebuild it: 'season' (a season in progress) or 'draft' (parked on the
-- clock, ready for a visitor to make picks).
ALTER TABLE ptl_seasons
  ADD COLUMN IF NOT EXISTS reset_seed TEXT;

CREATE INDEX IF NOT EXISTS idx_ptl_seasons_demo ON ptl_seasons(is_demo) WHERE is_demo;
