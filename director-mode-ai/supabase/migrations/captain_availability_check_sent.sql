-- Sent-stamp for the "availability check" timeline email: a couple of days
-- before the lineup goes out, each player sees the answer on file for them.
--
-- Adds the column only. The kind is OFF by default (KIND_META.check in
-- src/lib/captain/timeline.ts) and nothing here turns it on for any team.
ALTER TABLE captain_matches
  ADD COLUMN IF NOT EXISTS availability_check_sent_at timestamptz;
