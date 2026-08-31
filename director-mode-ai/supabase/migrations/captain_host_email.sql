-- Hosting a visiting team is a real job with real logistics, and until now the
-- opposing captain's email had nowhere to live: captain_matches stored their
-- name and phone but not the one field you actually need to send them anything.
ALTER TABLE captain_matches
  ADD COLUMN IF NOT EXISTS opposing_captain_email TEXT,
  ADD COLUMN IF NOT EXISTS host_email_sent_at TIMESTAMPTZ;

-- The venue blurb (parking, ice, restrooms, warmup courts) is identical for
-- every home match, so it belongs on the team, written once, not retyped per
-- match. Pre-fills the hosting email; still editable before every send.
ALTER TABLE captain_teams
  ADD COLUMN IF NOT EXISTS host_notes TEXT;
