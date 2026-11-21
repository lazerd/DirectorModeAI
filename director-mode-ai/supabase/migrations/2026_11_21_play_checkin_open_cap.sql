-- Racquets IRL parity with MixerMode (11/21/26):
--  * spots is optional: null = no cap, players are simply checked in as they arrive.
--  * check-in: "in" means signed up; checked_in_at means actually here. Only checked-in
--    players are put into rounds (by the host, or self check-in on arrival).
alter table play_events alter column spots drop not null;
alter table play_events alter column spots drop default;
alter table play_rsvps add column if not exists checked_in_at timestamptz;
alter table play_rsvps add column if not exists checked_in_by text check (checked_in_by in ('host','self'));
