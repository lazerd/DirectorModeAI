-- ============================================
-- Hosting a visiting team's home matches.
-- ============================================
-- A club with courts and spare weekend daytime can sell a whole USTA season to
-- a team that has no home club: N home matches on N courts for a flat fee, with
-- playoffs priced per match on top.
--
-- This is its own product, not a class and not a court booking:
--   - It is bought once and consumed over a season, so it has no meeting dates
--     to skip and no roster to take.
--   - It is a REQUEST before it is a sale. Five or six match days across three
--     to five courts is a large block of a club's best hours, and the director
--     has to look at the season before committing to it — so a team submits,
--     the club approves, and payment follows approval.
--
-- Both tables are club-scoped and every price is DATA. The numbers below live
-- in rows a director edits, not in a page, so a second club sells its own
-- packages without a line of code.
--
-- Safe to re-run.
-- ============================================

CREATE TABLE IF NOT EXISTS club_host_packages (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id             UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,

  label               TEXT NOT NULL,
  -- Courts the visiting team gets on a match day. USTA adult formats run 3 or
  -- 5 lines, which is why these are the two packages a club actually sells.
  courts              INT NOT NULL,
  -- Home matches the flat fee covers.
  matches_included    INT NOT NULL,
  price_cents         INT NOT NULL,
  -- Playoffs are per match, on top of the package.
  playoff_price_cents INT,

  blurb               TEXT,
  -- What the fee includes, as a list a captain can read.
  includes            JSONB NOT NULL DEFAULT '[]'::jsonb,

  active              BOOLEAN NOT NULL DEFAULT TRUE,
  display_order       INT NOT NULL DEFAULT 0,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (courts > 0 AND courts <= 40),
  CHECK (matches_included > 0 AND matches_included <= 40),
  CHECK (price_cents >= 0),
  CHECK (playoff_price_cents IS NULL OR playoff_price_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_club_host_packages_club
  ON club_host_packages(club_id, display_order);

-- --------------------------------------------
-- club_host_requests
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS club_host_requests (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id          UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  -- The package as chosen. Kept as SET NULL rather than CASCADE: a club
  -- retiring a package must not delete the record of who bought it.
  package_id       UUID REFERENCES club_host_packages(id) ON DELETE SET NULL,
  -- What the package said AT THE TIME. A club that raises its prices next
  -- season must not silently reprice a season somebody already agreed to.
  quoted_label     TEXT,
  quoted_courts    INT,
  quoted_matches   INT,
  quoted_cents     INT,
  quoted_playoff_cents INT,

  team_name        TEXT NOT NULL,
  league           TEXT,
  division         TEXT,
  captain_name     TEXT NOT NULL,
  captain_email    TEXT NOT NULL,
  captain_phone    TEXT,
  -- When they want to play. A league fixes home days, so this is the single
  -- most important thing for the club to check before saying yes.
  preferred_day    TEXT,
  preferred_time   TEXT,
  season_note      TEXT,
  expected_playoffs INT,

  status           TEXT NOT NULL DEFAULT 'requested'
                     CHECK (status IN ('requested','approved','declined','paid','cancelled')),
  -- Why it was declined, or anything the club wants on the record.
  staff_note       TEXT,
  decided_at       TIMESTAMPTZ,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_club_host_requests_club
  ON club_host_requests(club_id, status, created_at DESC);

-- --------------------------------------------
-- updated_at
-- --------------------------------------------
CREATE OR REPLACE FUNCTION touch_club_host_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_club_host_packages_updated_at ON club_host_packages;
CREATE TRIGGER trg_club_host_packages_updated_at
  BEFORE UPDATE ON club_host_packages
  FOR EACH ROW EXECUTE FUNCTION touch_club_host_updated_at();

DROP TRIGGER IF EXISTS trg_club_host_requests_updated_at ON club_host_requests;
CREATE TRIGGER trg_club_host_requests_updated_at
  BEFORE UPDATE ON club_host_requests
  FOR EACH ROW EXECUTE FUNCTION touch_club_host_updated_at();

-- --------------------------------------------
-- RLS
-- --------------------------------------------
-- Packages are a published price list — public read. Requests carry a captain's
-- name, email and phone, so staff only; the public INSERT goes through a
-- service-role route that can validate the package and rate-limit.
ALTER TABLE club_host_packages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS club_host_packages_public_read ON club_host_packages;
CREATE POLICY club_host_packages_public_read ON club_host_packages
  FOR SELECT USING (
    active
    AND EXISTS (SELECT 1 FROM cc_clubs c WHERE c.id = club_host_packages.club_id AND c.is_public)
  );

DROP POLICY IF EXISTS club_host_packages_staff_all ON club_host_packages;
CREATE POLICY club_host_packages_staff_all ON club_host_packages
  FOR ALL USING (is_club_team(club_id));

DROP POLICY IF EXISTS club_host_packages_owner_all ON club_host_packages;
CREATE POLICY club_host_packages_owner_all ON club_host_packages
  FOR ALL USING (
    EXISTS (SELECT 1 FROM cc_clubs c WHERE c.id = club_host_packages.club_id AND c.owner_id = auth.uid())
  );

ALTER TABLE club_host_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS club_host_requests_staff_all ON club_host_requests;
CREATE POLICY club_host_requests_staff_all ON club_host_requests
  FOR ALL USING (is_club_team(club_id));

DROP POLICY IF EXISTS club_host_requests_owner_all ON club_host_requests;
CREATE POLICY club_host_requests_owner_all ON club_host_requests
  FOR ALL USING (
    EXISTS (SELECT 1 FROM cc_clubs c WHERE c.id = club_host_requests.club_id AND c.owner_id = auth.uid())
  );

COMMENT ON TABLE club_host_packages IS
  'Season packages a club sells to a visiting team with no home courts. Public '
  'price list; every number is data so a second club sells its own.';
COMMENT ON COLUMN club_host_requests.quoted_cents IS
  'What the package cost when they agreed to it. A club raising prices next '
  'season must not silently reprice a season already agreed.';
