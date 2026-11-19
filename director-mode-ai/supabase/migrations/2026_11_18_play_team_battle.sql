-- Team Battle (two teams, strength-aligned lines) joins CourtConnect's formats.
alter table play_events drop constraint if exists play_events_format_check;
alter table play_events add constraint play_events_format_check check (format in ('maximize-courts','king-of-court','team-battle','doubles','mixed-doubles','singles'));
alter table play_rsvps add column if not exists team text check (team in ('A','B'));
