-- ============================================
-- On Deck — public wait board snapshots
-- ============================================
-- The wait board is public (parents scan a QR code), but the Serve Tennis
-- feed needs Darrin's personal session token. Putting that token in a
-- public page would hand his Serve Tennis session to anyone who opened it.
--
-- So the announcer page — which is already authenticated, on the desk
-- laptop — publishes a sanitised snapshot here every poll, and the public
-- board reads only this table. The token never leaves the desk laptop, and
-- the snapshot carries nothing but what is already on the order of play.
--
-- One row per tournament, overwritten in place. No history: this is a
-- live board, and yesterday's queue is of no interest to anyone.
--
-- Safe to re-run.
-- ============================================

CREATE TABLE IF NOT EXISTS td_snapshots (
  slug       TEXT PRIMARY KEY,
  title      TEXT NOT NULL DEFAULT '',
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE td_snapshots ENABLE ROW LEVEL SECURITY;

-- Reads happen through a public server route on the service role, and
-- writes require a signed-in director, so nothing needs direct table
-- access from the browser.
REVOKE ALL ON td_snapshots FROM anon, authenticated;
