-- The most lines one player takes in a single JTT match.
--
-- The sheet spreads eight lines over however many children turn up, so a small
-- squad puts some of them on three. Sometimes a player must be held to fewer —
-- and the REASON is the captain's business, not the app's, so this column
-- records only the number.
ALTER TABLE captain_players
  ADD COLUMN IF NOT EXISTS max_lines int;

ALTER TABLE captain_players DROP CONSTRAINT IF EXISTS captain_players_max_lines_check;
ALTER TABLE captain_players
  ADD CONSTRAINT captain_players_max_lines_check
  CHECK (max_lines IS NULL OR max_lines BETWEEN 1 AND 8);
