-- Optimize Courts (maximize-courts) is CourtConnect's featured format (Darrin, 11/18/26).
alter table play_events drop constraint if exists play_events_format_check;
alter table play_events add constraint play_events_format_check check (format in ('maximize-courts','doubles','mixed-doubles','singles'));
