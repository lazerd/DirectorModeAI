-- CaptainMode season email timeline: per-team automation settings and
-- per-match exceptions.
--
-- Before this, the daily cron hardcoded 7 / 2 / 1 days and captains could not
-- see, retime, retitle, or skip anything. Defaults below reproduce exactly the
-- old behaviour, so a team with no rows here sends what it sent yesterday.
--
-- 'poll' (the per-match availability blast) defaults to DISABLED because it has
-- always been captain-triggered; enabling it is an explicit choice in the UI,
-- never a side effect of this migration.

CREATE TABLE IF NOT EXISTS captain_email_settings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          uuid NOT NULL REFERENCES captain_teams(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('poll','nudge','lineup','reminder')),
  enabled          boolean NOT NULL DEFAULT true,
  -- Days before match_at. Fractional allowed, but the cron ticks once a day, so
  -- the real send lands on the first daily run at or after the due moment.
  lead_days        numeric(4,1) NOT NULL CHECK (lead_days >= 0 AND lead_days <= 120),
  subject_override text,
  intro_override   text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, kind)
);
CREATE INDEX IF NOT EXISTS captain_email_settings_team_idx ON captain_email_settings(team_id);

-- One match's exception to the team rule.
CREATE TABLE IF NOT EXISTS captain_email_overrides (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id          uuid NOT NULL REFERENCES captain_teams(id) ON DELETE CASCADE,
  match_id         uuid NOT NULL REFERENCES captain_matches(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('poll','nudge','lineup','reminder')),
  skip             boolean NOT NULL DEFAULT false,
  send_at          timestamptz,          -- explicit time, wins over lead_days
  subject_override text,
  intro_override   text,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_id, kind)
);
CREATE INDEX IF NOT EXISTS captain_email_overrides_team_idx  ON captain_email_overrides(team_id);
CREATE INDEX IF NOT EXISTS captain_email_overrides_match_idx ON captain_email_overrides(match_id);

-- The poll blast had no sent-stamp of its own on the match row until now; the
-- column exists already for manual sends, so nothing to add there.

ALTER TABLE captain_email_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE captain_email_overrides ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['captain_email_settings','captain_email_overrides'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'captain team scope', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO authenticated
         USING (captain_can_access_team(team_id))
         WITH CHECK (captain_can_access_team(team_id))',
      'captain team scope', t);
  END LOOP;
END $$;
