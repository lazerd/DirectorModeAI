-- Ledger for Clubessential clubs (11/25/26): turns the pros' lesson sheets into a
-- Clubessential member-charge import file. One row per club holds its setup:
--   roster   the club's member list (member number + name) from a Clubessential export
--   pros     [{name, sheet, employee}] each pro's Google Sheet and their name in Clubessential
--   setup    {area, items:{private,semi,group,clinic,other}, taxExempt, prices}
-- Access only through /api/ledger/* (service role after a club check).

CREATE TABLE IF NOT EXISTS clubessential_ledger (
  club_id            uuid PRIMARY KEY REFERENCES cc_clubs(id) ON DELETE CASCADE,
  roster             jsonb NOT NULL DEFAULT '[]'::jsonb,
  roster_updated_at  timestamptz,
  pros               jsonb NOT NULL DEFAULT '[]'::jsonb,
  setup              jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE clubessential_ledger ENABLE ROW LEVEL SECURITY;

-- Each build is kept (what was in the file, what needed the director), so nothing is
-- built twice by accident and the receipt shows on the Pro Shop board.
CREATE TABLE IF NOT EXISTS clubessential_ledger_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  date_from   date NOT NULL,
  date_to     date NOT NULL,
  charges     int NOT NULL,
  total_cents int NOT NULL,
  needs_you   int NOT NULL,
  csv         text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ce_runs_club ON clubessential_ledger_runs (club_id, created_at DESC);
ALTER TABLE clubessential_ledger_runs ENABLE ROW LEVEL SECURITY;
