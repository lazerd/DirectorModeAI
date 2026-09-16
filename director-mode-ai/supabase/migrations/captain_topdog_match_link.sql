-- Which match on the league site this CaptainMode match is.
--
-- TopDog's "Enter Score" page is ScoreCardEntry.asp?s=<match id> on the
-- league's own host (fallleague.topdoglive.com, sleepyhollowswimtennis…), so
-- the button that carries a captain's saved scores there needs both halves.
-- Filled by captain-provision.js, or pasted on the match page from any TopDog
-- link for that match.
ALTER TABLE captain_matches
  ADD COLUMN IF NOT EXISTS source_host     text,
  ADD COLUMN IF NOT EXISTS source_match_id text;
