-- The other team's players on each court, as written on the scorecard.
--
-- ClubMode never knew them, so filling TopDog's score card left every
-- opponent box for the captain even when the names were right there on the
-- photographed card. The photo reader now reads them, the captain can edit
-- them, and the TopDog fill matches them against the opponent's roster.
ALTER TABLE captain_results
  ADD COLUMN IF NOT EXISTS opponent_names text[];
