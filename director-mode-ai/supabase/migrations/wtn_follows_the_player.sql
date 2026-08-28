-- WTN belongs to the PERSON, not to each tool's private copy of them.
--
-- Before this, "wtn" was declared in three unrelated places — league_entries,
-- league_team_rosters and captain_players — and populated in none of them. Each
-- tool would have collected the same number separately and then disagreed about
-- it. master_players is the identity hub (469 people, already linked from 11
-- tables), so the number lives there once and every surface reads it.
alter table master_players add column if not exists wtn numeric;
alter table master_players add column if not exists wtn_doubles numeric;
alter table master_players add column if not exists wtn_updated_at timestamptz;
-- Where it came from: 'usta_paste' (a captain pasting from usta.com), 'manual'
-- (typed into a roster), or an API source later. Kept so an automatic sync can
-- one day refuse to overwrite a number a human deliberately set.
alter table master_players add column if not exists wtn_source text;

alter table master_players drop constraint if exists master_players_wtn_source_chk;
alter table master_players add constraint master_players_wtn_source_chk
  check (wtn_source is null or wtn_source in ('usta_paste','manual','usta_api'));

-- WTN runs 1 (pro) to 40 (beginner). A value outside that band is a parsing
-- accident — an NTRP rating or a match count — and on an inverted scale it
-- silently promotes whoever holds it, so the database refuses it outright.
alter table master_players drop constraint if exists master_players_wtn_band_chk;
alter table master_players add constraint master_players_wtn_band_chk
  check (wtn is null or (wtn >= 1 and wtn <= 40));

alter table master_players drop constraint if exists master_players_wtn_doubles_band_chk;
alter table master_players add constraint master_players_wtn_doubles_band_chk
  check (wtn_doubles is null or (wtn_doubles >= 1 and wtn_doubles <= 40));

-- CaptainMode rosters were the only player table with no link to the identity
-- hub, which is exactly why a WTN pasted there could not reach anything else.
alter table captain_players add column if not exists master_player_id uuid
  references master_players(id) on delete set null;

create index if not exists captain_players_master_player_id_idx
  on captain_players(master_player_id);
