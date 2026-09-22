-- WTN lookup (2026-09-22): remember WHO on worldtennisnumber.com a player is,
-- so a refresh never has to guess from a name twice.
--
-- The ITF search is fuzzy — "Darrin Cohen" also returns Darrin Schain and Max
-- Cohen — so a name match is only ever the FIRST resolve. Once tennis_id is
-- stored, every later refresh is exact.
--
-- Confidence is the ITF's own 0-100 on each number: it reflects how many rated
-- matches back it. Club players are routinely 10-40, and the public search
-- hides anything at or below 60 by default, which is why those numbers have
-- been invisible. Store it so a soft number can be shown as soft.

alter table master_players
  add column if not exists wtn_tennis_id text,
  add column if not exists wtn_singles_confidence smallint,
  add column if not exists wtn_doubles_confidence smallint,
  add column if not exists wtn_checked_at timestamptz;

comment on column master_players.wtn_tennis_id is
  'ITF World Tennis ID (e.g. COH7329231). Set once by name match, then used for exact refresh.';
comment on column master_players.wtn_checked_at is
  'Last time worldtennisnumber.com was searched for this person, found or not — stops us re-searching the same misses.';

create index if not exists master_players_wtn_tennis_id_idx
  on master_players (wtn_tennis_id) where wtn_tennis_id is not null;

alter table master_players
  drop constraint if exists master_players_wtn_confidence_chk;
alter table master_players
  add constraint master_players_wtn_confidence_chk check (
    (wtn_singles_confidence is null or wtn_singles_confidence between 0 and 100)
    and (wtn_doubles_confidence is null or wtn_doubles_confidence between 0 and 100)
  );

-- wtn_source was limited to how a number arrived by hand or via the USTA API.
-- 'itf' is the public worldtennisnumber.com search, matched by name once and
-- then held by World Tennis ID. Keep the constraint — it is what stops a typo
-- becoming a provenance.
alter table master_players drop constraint if exists master_players_wtn_source_chk;
alter table master_players add constraint master_players_wtn_source_chk check (
  wtn_source is null or wtn_source = any (array['usta_paste','manual','usta_api','itf'])
);
