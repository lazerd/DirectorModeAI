-- Who recorded a lineup confirmation: the player, or the captain on their behalf.
--
-- Players don't always tap the button. They text the captain, or say yes at the
-- club, and the captain then has a roll-call that says "no answer yet" for
-- someone they have already spoken to. Letting the captain record it fixes the
-- roll-call — but a confirmation the captain typed in is a weaker fact than one
-- the player tapped, so the source is kept rather than blurred together.
alter table captain_lineups add column if not exists player1_confirmed_source text;
alter table captain_lineups add column if not exists player2_confirmed_source text;

alter table captain_lineups drop constraint if exists captain_lineups_p1_confirmed_source_chk;
alter table captain_lineups add constraint captain_lineups_p1_confirmed_source_chk
  check (player1_confirmed_source is null or player1_confirmed_source in ('player','captain'));

alter table captain_lineups drop constraint if exists captain_lineups_p2_confirmed_source_chk;
alter table captain_lineups add constraint captain_lineups_p2_confirmed_source_chk
  check (player2_confirmed_source is null or player2_confirmed_source in ('player','captain'));
