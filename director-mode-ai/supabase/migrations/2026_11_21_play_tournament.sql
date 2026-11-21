-- Racquets IRL tournaments (MixerMode draws: round robin now, brackets later).
-- The real draw type lives in play_events.state.draw.format, so later formats need no DB change.
alter table play_events drop constraint if exists play_events_format_check;
alter table play_events add constraint play_events_format_check check (format in ('maximize-courts','king-of-court','team-battle','doubles','mixed-doubles','singles','tournament'));
