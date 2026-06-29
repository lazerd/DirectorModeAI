-- Winner configuration for mixer events.
-- num_winners: how many overall winners to highlight on the results.
-- winners_split_gender: when true, results show one top woman + one top man
--   (relies on players.gender being set).
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS num_winners INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS winners_split_gender BOOLEAN NOT NULL DEFAULT false;
