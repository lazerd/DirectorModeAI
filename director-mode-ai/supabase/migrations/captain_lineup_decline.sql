-- CaptainMode: a player can pull OUT of a lineup from the lineup email.
--
-- Deliberately does NOT null the slot. When someone withdraws the captain still
-- needs to see who was there in order to replace them ("find a sub" is a
-- per-slot button), so the withdrawal is a stamp on the slot, not an erasure.
-- Confirmed and declined are mutually exclusive: the route clears the other one.
alter table captain_lineups
  add column if not exists player1_declined_at timestamptz,
  add column if not exists player2_declined_at timestamptz,
  add column if not exists player1_decline_note text,
  add column if not exists player2_decline_note text;
