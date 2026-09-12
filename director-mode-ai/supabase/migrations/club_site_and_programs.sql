-- ============================================
-- Club Sites — a club's own public website, and the classes it sells.
-- ============================================
-- Three tables:
--
--   club_site                   the marketing content, one row per club
--   club_programs               a recurring class: dates, skip dates, prices
--   club_program_registrations  who enrolled
--
-- WHY NOT cc_clubs FOR THE SITE CONTENT. cc_clubs is read on nearly every
-- request (CLUB_COLS in lib/courtsheet/routeAuth, middleware, /member) and
-- /club/[slug] does a literal select('*') on it from the browser. Twenty
-- nullable marketing columns on the hottest table in the app, half of them
-- unpublished drafts, is a liability. A separate table also gets exactly the
-- RLS it needs and a clean draft/publish lifecycle. The club's FACTS — phone,
-- email, address, timezone, logo_url, cover_image_url, operating_hours — stay
-- on cc_clubs where they already are and where the rest of the app reads them.
-- The renderer joins.
--
-- WHY NOT reservation_series FOR THE PROGRAMS. It is tempting: it already
-- carries range/days_of_week/time and an `exclusions` array, and
-- lib/courtsheet/recurrence.ts already expands it. But:
--
--   1. RLS. Its type CHECK includes 'blackout', 'hold' and 'maintenance', and
--      it has no public read policy. Adding one to sell a class would publish
--      every blackout and hold the club has.
--   2. A series needs courts; a program does not. expandSeries resolves
--      intent.courts and emits one instance per court x date. A director has to
--      be able to sell "After-School Juniors, Tue/Thu 3:30" before deciding
--      which courts, and a partner's swim program has no court at all.
--   3. Its exclusions are effectively write-once — createSeriesFromPlan writes
--      them at creation from the AI intent and nothing re-materializes
--      reservations when they change.
--
-- So a program is its own row, with an OPTIONAL series_id for when the club
-- also wants the courts blocked. The recurrence MATH is still shared: see
-- lib/programs/sessions.ts, which reuses the same club-local date helpers.
--
-- NO SESSIONS TABLE, on purpose. A class's meeting dates are a pure function
-- of (range_start, range_end, days_of_week, exclusions, timezone). Storing them
-- would be a cache needing invalidation on exactly the edit that has to be
-- instant and atomic — adding a skip date.
--
-- Safe to re-run.
-- ============================================

-- --------------------------------------------
-- club_site
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS club_site (
  club_id             UUID PRIMARY KEY REFERENCES cc_clubs(id) ON DELETE CASCADE,

  -- Brand. Deliberately the same five keys as Sponsor.colors in
  -- config/sponsors.ts, so the renderer can reuse the inline-style approach
  -- already proven in components/quads/SponsoredQuadLanding.tsx.
  color_primary       TEXT,
  color_secondary     TEXT,
  color_ink           TEXT,
  color_cream         TEXT,
  color_surface       TEXT,
  -- An enum of safe stacks resolved in lib/clubSite/theme.ts, not free text:
  -- a club typing a font name it does not own renders as Times on every phone.
  font_choice         TEXT,

  hero_headline       TEXT,
  hero_subhead        TEXT,
  hero_image_url      TEXT,
  hero_cta_label      TEXT,
  hero_cta_href       TEXT,

  about_body          TEXT,
  courts_blurb        TEXT,
  -- Where "members free, 7 days ahead / public $24/hr, 3 days ahead" lives
  -- until there is a booking engine. Published POLICY, not a promise of software.
  booking_policy_body TEXT,

  -- JSONB because these are display lists: never queried across clubs, never
  -- joined, no per-row RLS, and a whole list saves as one UPDATE from a form
  -- with add/remove rows. Six child tables would be six CRUD endpoints for
  -- content nothing references. Shapes are validated by Zod in
  -- lib/clubSite/schema.ts so the editor and the renderer cannot disagree.
  amenities           JSONB NOT NULL DEFAULT '[]'::jsonb,
  membership_tiers    JSONB NOT NULL DEFAULT '[]'::jsonb,
  staff               JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Other pros' own programs, linked out rather than sold here.
  partner_links       JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- The member packet, and anything else that is a PDF.
  documents           JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Stringing, ball machine.
  services            JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Court rates by time of day. DISPLAY in phase 1; phase 2 turns these into
  -- a real rate card the booking flow prices against.
  court_rates         JSONB NOT NULL DEFAULT '[]'::jsonb,
  nav_links           JSONB NOT NULL DEFAULT '[]'::jsonb,

  status              TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  seo_title           TEXT,
  seo_description     TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- --------------------------------------------
-- club_programs
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS club_programs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id               UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  slug                  TEXT NOT NULL,
  title                 TEXT NOT NULL,
  subtitle              TEXT,
  sport                 TEXT NOT NULL DEFAULT 'tennis'
                          CHECK (sport IN ('tennis','pickleball','padel','swim','fitness','other')),
  audience              TEXT NOT NULL DEFAULT 'all'
                          CHECK (audience IN ('junior','adult','family','all')),
  age_min               INT,
  age_max               INT,
  level_note            TEXT,

  -- THE COLUMNS A DIRECTOR CHANGES EVERY SEASON, and the whole reason this
  -- table exists. Dates in the club's timezone; times are club-local, no date.
  range_start           DATE NOT NULL,
  range_end             DATE NOT NULL,
  -- Postgres DOW: 0=Sun..6=Sat. Empty means every day in range.
  days_of_week          INT[] NOT NULL DEFAULT '{}',
  -- Skip dates. Same name and shape as reservation_series.exclusions on
  -- purpose, so the two can be reconciled when a program blocks courts.
  exclusions            DATE[] NOT NULL DEFAULT '{}',
  time_start            TIME NOT NULL,
  time_end              TIME NOT NULL,

  -- Explicit price columns, not JSONB. JSONB pricing means a JSON editor,
  -- which is the thing a director is paying a developer to avoid. Three number
  -- inputs and a note is a thirty-second job.
  price_cents           INT NOT NULL DEFAULT 0,
  member_price_cents    INT,
  drop_in_price_cents   INT,
  price_note            TEXT,

  capacity              INT,
  waitlist_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  registration_opens_at TIMESTAMPTZ,
  registration_closes_at TIMESTAMPTZ,
  registration_mode     TEXT NOT NULL DEFAULT 'online'
                          CHECK (registration_mode IN ('online','email','closed')),

  -- Named to match events.external_payment_url, and validated by the same
  -- isPaymentLink() in config/payments.ts. Until a club can connect its own
  -- Square or Stripe, this is how its money reaches its own bank.
  external_payment_url  TEXT,

  description           TEXT,
  coach_name            TEXT,
  coach_id              UUID,
  location_note         TEXT,
  image_url             TEXT,
  display_order         INT NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft','published','archived')),

  -- Optional: the court block this class also owns. Null is normal.
  series_id             UUID REFERENCES reservation_series(id) ON DELETE SET NULL,

  created_by            UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (range_end >= range_start),
  CHECK (time_end > time_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_club_programs_slug ON club_programs(club_id, slug);
CREATE INDEX IF NOT EXISTS idx_club_programs_club ON club_programs(club_id, status, display_order);

-- --------------------------------------------
-- club_program_registrations
-- --------------------------------------------
-- Keyed to the PROGRAM, not to a session.
--
-- Not reservation_signups: that is reservation_id-scoped, one court on one
-- date, so a ten-week enrollment would be ten rows and adding a skip date
-- would mean deleting signup rows per family. Wrong grain.
--
-- Not tournament_entries: that needs an events row and carries seeds, draws
-- and player tokens; its `position` values are bracket vocabulary.
--
-- This table is also the club's "everyone who ever registered" list, which is
-- what makes emailing past participants possible at all.
CREATE TABLE IF NOT EXISTS club_program_registrations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id        UUID NOT NULL REFERENCES club_programs(id) ON DELETE CASCADE,
  club_id           UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,

  participant_name  TEXT NOT NULL,
  participant_dob   DATE,
  parent_name       TEXT,
  parent_email      TEXT NOT NULL,
  parent_phone      TEXT,
  notes             TEXT,

  status            TEXT NOT NULL DEFAULT 'enrolled'
                      CHECK (status IN ('enrolled','waitlist','cancelled')),
  -- Same vocabulary as tournament_entries, so "mark paid" means one thing
  -- everywhere in the app.
  payment_status    TEXT NOT NULL DEFAULT 'pending'
                      CHECK (payment_status IN ('pending','paid','waived','refunded')),
  amount_cents      INT,

  -- Registrants join the existing player spine, so a club can reach them for
  -- years rather than only for the program they signed up to.
  master_player_id  UUID,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cpr_program ON club_program_registrations(program_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_cpr_club_email ON club_program_registrations(club_id, lower(parent_email));
-- One family cannot enroll the same child twice, but a cancelled row must not
-- block a genuine re-enrollment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cpr_no_dupes
  ON club_program_registrations(program_id, lower(parent_email), lower(participant_name))
  WHERE status <> 'cancelled';

-- --------------------------------------------
-- updated_at triggers
-- --------------------------------------------
CREATE OR REPLACE FUNCTION touch_club_site_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_club_site_updated_at ON club_site;
CREATE TRIGGER trg_club_site_updated_at
  BEFORE UPDATE ON club_site
  FOR EACH ROW EXECUTE FUNCTION touch_club_site_updated_at();

DROP TRIGGER IF EXISTS trg_club_programs_updated_at ON club_programs;
CREATE TRIGGER trg_club_programs_updated_at
  BEFORE UPDATE ON club_programs
  FOR EACH ROW EXECUTE FUNCTION touch_club_site_updated_at();

DROP TRIGGER IF EXISTS trg_cpr_updated_at ON club_program_registrations;
CREATE TRIGGER trg_cpr_updated_at
  BEFORE UPDATE ON club_program_registrations
  FOR EACH ROW EXECUTE FUNCTION touch_club_site_updated_at();

-- --------------------------------------------
-- RLS
-- --------------------------------------------
-- Staff manage, via is_club_team() — owner/director/coach/front_desk, never
-- role=member, which is what the public join link grants.
--
-- The public may read a PUBLISHED site and PUBLISHED programs at a PUBLIC
-- club, and may read nothing at all from the registrations table: those rows
-- carry children's names and parents' phone numbers. Public signup is an
-- INSERT through a service-role API route that checks capacity server-side,
-- NOT a public INSERT policy — a policy cannot count the waitlist.

ALTER TABLE club_site ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS club_site_staff_all ON club_site;
CREATE POLICY club_site_staff_all ON club_site
  FOR ALL USING (is_club_team(club_id));

DROP POLICY IF EXISTS club_site_owner_all ON club_site;
CREATE POLICY club_site_owner_all ON club_site
  FOR ALL USING (
    EXISTS (SELECT 1 FROM cc_clubs c WHERE c.id = club_site.club_id AND c.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS club_site_public_read ON club_site;
CREATE POLICY club_site_public_read ON club_site
  FOR SELECT USING (
    status = 'published'
    AND EXISTS (SELECT 1 FROM cc_clubs c WHERE c.id = club_site.club_id AND c.is_public)
  );

ALTER TABLE club_programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS club_programs_staff_all ON club_programs;
CREATE POLICY club_programs_staff_all ON club_programs
  FOR ALL USING (is_club_team(club_id));

DROP POLICY IF EXISTS club_programs_owner_all ON club_programs;
CREATE POLICY club_programs_owner_all ON club_programs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM cc_clubs c WHERE c.id = club_programs.club_id AND c.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS club_programs_public_read ON club_programs;
CREATE POLICY club_programs_public_read ON club_programs
  FOR SELECT USING (
    status = 'published'
    AND EXISTS (SELECT 1 FROM cc_clubs c WHERE c.id = club_programs.club_id AND c.is_public)
  );

ALTER TABLE club_program_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cpr_staff_all ON club_program_registrations;
CREATE POLICY cpr_staff_all ON club_program_registrations
  FOR ALL USING (is_club_team(club_id));

DROP POLICY IF EXISTS cpr_owner_all ON club_program_registrations;
CREATE POLICY cpr_owner_all ON club_program_registrations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM cc_clubs c
      WHERE c.id = club_program_registrations.club_id AND c.owner_id = auth.uid()
    )
  );
-- Deliberately no public policy of any kind.

-- --------------------------------------------
-- Storage: hero images, staff photos, member packets
-- --------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('club-site', 'club-site', TRUE)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE club_site IS
  'A club''s public website content. One row per club, joined to cc_clubs for '
  'the facts (phone/address/logo/hours). Rendered at /c/[slug], edited at /run/site.';
COMMENT ON TABLE club_programs IS
  'A recurring class a club sells. exclusions[] holds the skip dates; meeting '
  'dates are COMPUTED from the range by lib/programs/sessions.ts, never stored.';
COMMENT ON COLUMN club_programs.series_id IS
  'Optional link to the reservation_series blocking the courts for this class. '
  'Null is normal — a class can be published and sold before courts are assigned.';
