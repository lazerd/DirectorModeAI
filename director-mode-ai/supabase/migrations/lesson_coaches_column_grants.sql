-- lesson_coaches is a directory: /find-coach and /coach/[slug] read it without
-- a session, and that is the feature. But google_calendar_id and ics_url say
-- which calendar an instructor connected — and a published iCloud feed URL is a
-- readable copy of their calendar — while no browser has ever needed either.
--
-- Row policies cannot say "not this column", so this is done with column
-- grants: everything except those two stays readable.
--
-- NOTE: revoking a column from a role that held a table-wide grant converts the
-- grant to per-column, and any column added LATER is then ungranted. So the
-- grant is written out explicitly rather than as a revoke, and any new column
-- on this table must be added here deliberately.
REVOKE SELECT ON lesson_coaches FROM anon, authenticated;
GRANT SELECT (id, profile_id, display_name, created_at, slug, email, club_id, open_keyword, open_page_enabled, open_page_note, booking_lead_hours, timezone, open_synced_at, open_durations, open_rate_note, calendar_kind) ON lesson_coaches TO anon, authenticated;
