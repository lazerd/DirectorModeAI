-- Padel is a /play sport alongside tennis and pickleball.
alter table play_events drop constraint if exists play_events_sport_check;
alter table play_events add constraint play_events_sport_check check (sport in ('tennis','pickleball','padel'));
