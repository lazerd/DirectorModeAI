-- Mirror the hub's WTN onto the club-scoped player tables.
--
-- master_players is the source of truth, but it is RLS-locked to service_role
-- on purpose: it holds contact details for every person across every club, and
-- opening it to browser clients would leak PII across the club boundary (see
-- the is_club_team vs is_club_member rule). So the browser can never read the
-- hub directly.
--
-- The answer is the same one the identity sync already uses: club-scoped tables
-- carry a COPY, protected by the RLS those tables already have, and the hub
-- pushes updates out to them. Writes go to the hub first and propagate; nothing
-- reads a club table expecting to find a newer value than the hub has.
alter table cc_vault_players add column if not exists wtn numeric;
alter table cc_vault_players add column if not exists wtn_doubles numeric;

-- Same band guard as the hub: WTN runs 1 (pro) to 40 (beginner), and a value
-- outside it is a mis-parse that, on an inverted scale, silently promotes
-- whoever holds it to the strongest player in the club.
alter table cc_vault_players drop constraint if exists cc_vault_players_wtn_band_chk;
alter table cc_vault_players add constraint cc_vault_players_wtn_band_chk
  check (wtn is null or (wtn >= 1 and wtn <= 40));

alter table cc_vault_players drop constraint if exists cc_vault_players_wtn_doubles_band_chk;
alter table cc_vault_players add constraint cc_vault_players_wtn_doubles_band_chk
  check (wtn_doubles is null or (wtn_doubles >= 1 and wtn_doubles <= 40));

-- MixerMode's own player table, so socials, mixers and quads can show it too.
alter table players add column if not exists wtn numeric;
alter table players add column if not exists wtn_doubles numeric;

alter table players drop constraint if exists players_wtn_band_chk;
alter table players add constraint players_wtn_band_chk
  check (wtn is null or (wtn >= 1 and wtn <= 40));

alter table players drop constraint if exists players_wtn_doubles_band_chk;
alter table players add constraint players_wtn_doubles_band_chk
  check (wtn_doubles is null or (wtn_doubles >= 1 and wtn_doubles <= 40));
