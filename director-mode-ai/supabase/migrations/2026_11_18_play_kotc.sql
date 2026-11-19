-- King of the Court (winners up, losers down) joins CourtConnect's formats.
alter table play_events drop constraint if exists play_events_format_check;
alter table play_events add constraint play_events_format_check check (format in ('maximize-courts','king-of-court','doubles','mixed-doubles','singles'));
