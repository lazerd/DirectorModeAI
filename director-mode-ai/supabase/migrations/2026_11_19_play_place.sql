-- /play: a game's place can be pinned on the map (picked from suggestions).
alter table play_events add column if not exists place_address text;
alter table play_events add column if not exists place_lat double precision;
alter table play_events add column if not exists place_lng double precision;
