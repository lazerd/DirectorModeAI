-- WTN (World Tennis Number) and mobile numbers for CaptainMode rosters.
--
-- WTN runs 40 (beginner) → 1 (pro): LOWER is stronger, the opposite of NTRP.
-- Every comparison in the app therefore has to know which scale it is holding,
-- which is why these live in their own columns rather than overloading
-- `rating`. Singles and doubles are separate numbers on a player's USTA
-- profile and a doubles league should be ordered on the doubles one.
alter table captain_players add column if not exists wtn numeric;
alter table captain_players add column if not exists wtn_doubles numeric;
alter table captain_players add column if not exists wtn_updated_at timestamptz;

-- Mobile number, for texting a lineup change to one player.
alter table captain_players add column if not exists phone text;
