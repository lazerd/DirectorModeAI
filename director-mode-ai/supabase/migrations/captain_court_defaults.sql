-- A defaulted court is a result without a match.
--
-- The team still wins (or loses) the point, but nobody hit a ball, so the two
-- players named on that court did NOT play. That distinction is load-bearing:
-- matches-played drives both play-time fairness and USTA playoff eligibility,
-- and crediting a default would tell a captain someone is covered when they are
-- still sitting on zero.
ALTER TABLE captain_results
  ADD COLUMN IF NOT EXISTS defaulted  BOOLEAN NOT NULL DEFAULT false,
  -- Who defaulted. 'them' = we won the court without playing; 'us' = we could
  -- not field it. Either way our named players did not play.
  ADD COLUMN IF NOT EXISTS default_by TEXT;

ALTER TABLE captain_results DROP CONSTRAINT IF EXISTS captain_results_default_by_check;
ALTER TABLE captain_results
  ADD CONSTRAINT captain_results_default_by_check
  CHECK (default_by IS NULL OR default_by IN ('us', 'them'));
