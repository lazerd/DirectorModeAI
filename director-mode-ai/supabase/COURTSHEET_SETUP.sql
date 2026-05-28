-- =================================================================
-- CourtSheet AI — one-shot setup
-- =================================================================
-- Paste this entire file into the Supabase SQL editor and Run.
-- Idempotent end-to-end — safe to re-run.
--
-- Contents (all 11 CourtSheet migrations in order):
--   001 extensions          btree_gist (linchpin) + uuid-ossp
--   002 clubs_extend        cc_clubs.timezone/operating_hours + cc_club_members
--   003 courts              bookable courts table
--   004 reservation_series  recurrence template (camp Mon-Fri etc)
--   005 reservations        single source of truth + no_double_booking EXCLUDE
--   006 signups             reservation_signups (clinics/doubles/socials)
--   007 audit               courtsheet_audit_log for who/what/when/undo
--   008 backfill            SQL helpers (no data move)
--   009 seed_sleepy_hollow  Sleepy Hollow cc_clubs + 8 numbered courts
--   010 lessons_court_id    nullable court_id on lesson_slots
--   011 realtime            adds reservations + signups to supabase_realtime
--
-- ALTERs touch these existing tables:
--   cc_clubs       — adds nullable/defaulted timezone + operating_hours
--   lesson_slots   — adds nullable court_id
-- No existing row is invalidated.
-- =================================================================

-- ============================================
-- CourtSheet AI — Phase 1 / Migration 001
-- Extensions required by the reservation engine.
-- ============================================
-- btree_gist lets a GiST index mix b-tree-style equality (court_id =) with
-- a range overlap (tstzrange &&). That combination is the linchpin of
-- migration 005's no-double-booking EXCLUDE constraint. Supabase allows
-- this extension on the standard plan.
--
-- uuid-ossp is already enabled by earlier migrations; included here for
-- safety so this file is standalone.
--
-- Safe to re-run.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS btree_gist;
-- ============================================
-- CourtSheet AI — Phase 1 / Migration 002
-- Extend cc_clubs into the CourtSheet club entity + members join.
-- ============================================
-- *** REVIEW BEFORE APPLYING — this migration ALTERS an existing live table
--     (cc_clubs). All adds are nullable-or-defaulted so no existing row
--     breaks, but please eyeball it before running in the SQL editor. ***
--
-- Adds to cc_clubs:
--   - timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles'
--       The club's wall-clock timezone. ALL recurrence math runs in this
--       TZ so a 9 AM clinic stays 9 AM across DST transitions.
--   - operating_hours JSONB NOT NULL DEFAULT '{}'
--       Per-day-of-week open/close windows. Shape:
--         { "0": null,                                  -- Sunday closed
--           "1": [{"open":"06:00","close":"22:00"}],    -- Mon–Fri 6–10
--           ...
--           "6": [{"open":"07:00","close":"21:00"}] }   -- Saturday
--       Null/missing day = closed. Multiple windows allowed (split hours).
--       Empty {} = no constraint (legacy clubs, treated as 24/7).
--
-- New table cc_club_members:
--   The membership join that decides who can read/write a club's sheet.
--   Role-scoped: owner has full control, director nearly so, coach can
--   manage their own bookings, front_desk can read+create but not destroy,
--   member is the player-side view (read-only public surface).
--
-- Safe to re-run.
-- ============================================

ALTER TABLE cc_clubs
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  ADD COLUMN IF NOT EXISTS operating_hours JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS cc_club_members (
  club_id    UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member'
              CHECK (role IN ('owner','director','coach','front_desk','member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (club_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_cc_club_members_user ON cc_club_members(user_id);
CREATE INDEX IF NOT EXISTS idx_cc_club_members_club_role ON cc_club_members(club_id, role);

ALTER TABLE cc_club_members ENABLE ROW LEVEL SECURITY;

-- Owners + directors manage membership.
DROP POLICY IF EXISTS "Owners and directors manage memberships" ON cc_club_members;
CREATE POLICY "Owners and directors manage memberships" ON cc_club_members
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = cc_club_members.club_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner','director')
    )
    OR EXISTS (
      SELECT 1 FROM cc_clubs c
      WHERE c.id = cc_club_members.club_id
        AND c.owner_id = auth.uid()
    )
  );

-- Members can see who else is in their club.
DROP POLICY IF EXISTS "Members can view club roster" ON cc_club_members;
CREATE POLICY "Members can view club roster" ON cc_club_members
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = cc_club_members.club_id
        AND m.user_id = auth.uid()
    )
  );

-- Mirror cc_clubs.owner_id into cc_club_members so the membership check is
-- the single source of truth. Idempotent: only inserts owners not already
-- present as members.
INSERT INTO cc_club_members (club_id, user_id, role)
SELECT id, owner_id, 'owner'
FROM cc_clubs
ON CONFLICT (club_id, user_id) DO NOTHING;
-- ============================================
-- CourtSheet AI — Phase 1 / Migration 003
-- The `courts` table — the bookable units.
-- ============================================
-- A court is a physical surface that can be reserved. Distinct from the
-- per-event `events.court_names TEXT[]` arrays used by Quads/Tournaments
-- today — those become labels that resolve into court_id once a club's
-- courts are seeded. The court_names arrays are preserved unchanged.
--
-- `number` is the user-facing index ("Court 1") and is what the AI parses
-- when a director says "courts 1 through 6". Uniqueness is per-club.
--
-- Safe to re-run.
-- ============================================

CREATE TABLE IF NOT EXISTS courts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id       UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  number        INT  NOT NULL,
  name          TEXT,
  sports        TEXT[] NOT NULL DEFAULT '{tennis}',
  surface       TEXT,
  indoor        BOOLEAN NOT NULL DEFAULT false,
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','maintenance','hidden')),
  display_order INT  NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (club_id, number)
);

CREATE INDEX IF NOT EXISTS idx_courts_club_display ON courts(club_id, display_order, number);
CREATE INDEX IF NOT EXISTS idx_courts_club_status ON courts(club_id, status);

CREATE OR REPLACE FUNCTION touch_courts_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_courts_updated_at ON courts;
CREATE TRIGGER trg_courts_updated_at
  BEFORE UPDATE ON courts
  FOR EACH ROW EXECUTE FUNCTION touch_courts_updated_at();

ALTER TABLE courts ENABLE ROW LEVEL SECURITY;

-- Members can read their club's courts (drives the public member view).
DROP POLICY IF EXISTS "Club members can read courts" ON courts;
CREATE POLICY "Club members can read courts" ON courts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = courts.club_id
        AND m.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM cc_clubs c
      WHERE c.id = courts.club_id AND c.is_public = true
    )
  );

-- Owners + directors + front_desk write courts. Coaches read-only.
DROP POLICY IF EXISTS "Staff manage courts" ON courts;
CREATE POLICY "Staff manage courts" ON courts
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = courts.club_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner','director','front_desk')
    )
  );
-- ============================================
-- CourtSheet AI — Phase 1 / Migration 004
-- `reservation_series` — the recurrence template.
-- ============================================
-- One series materializes into N concrete reservations across N
-- (court × date) combos. The series stores the intent (range, days-of-week,
-- time window, exclusions) in club-local terms; the engine expands it into
-- UTC reservations at write time so DST never warps a 9 AM clinic.
--
-- `intent` JSONB holds the structured booking intent that produced the
-- series (the same payload the AI agent emits). Keeping it around lets us
-- replay, audit, and rebuild instances if a series-wide edit lands.
--
-- Safe to re-run.
-- ============================================

CREATE TABLE IF NOT EXISTS reservation_series (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id       UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  type          TEXT NOT NULL
                  CHECK (type IN ('camp','lesson','event','match','member','maintenance','blackout','hold')),
  -- Date window in the CLUB'S TIMEZONE. Compute in local, store as DATE.
  range_start   DATE NOT NULL,
  range_end     DATE NOT NULL,
  -- Time window in CLUB-LOCAL time, no date.
  time_start    TIME NOT NULL,
  time_end      TIME NOT NULL,
  -- Days of week the series fires on. Postgres DOW: 0=Sun..6=Sat.
  -- An empty array means "every day in range" (single-day or all-days bookings).
  days_of_week  INT[] NOT NULL DEFAULT '{}',
  -- DATEs to skip (holidays, exceptions, etc).
  exclusions    DATE[] NOT NULL DEFAULT '{}',
  -- The full structured intent the agent emitted, kept for replay/audit.
  intent        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Free-form per-series metadata (coach_id, group name, color override, ...).
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by    UUID NOT NULL REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (range_end >= range_start),
  CHECK (time_end > time_start)
);

CREATE INDEX IF NOT EXISTS idx_reservation_series_club ON reservation_series(club_id, range_start, range_end);

CREATE OR REPLACE FUNCTION touch_reservation_series_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reservation_series_updated_at ON reservation_series;
CREATE TRIGGER trg_reservation_series_updated_at
  BEFORE UPDATE ON reservation_series
  FOR EACH ROW EXECUTE FUNCTION touch_reservation_series_updated_at();

ALTER TABLE reservation_series ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Club staff manage series" ON reservation_series;
CREATE POLICY "Club staff manage series" ON reservation_series
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = reservation_series.club_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner','director','coach','front_desk')
    )
  );

DROP POLICY IF EXISTS "Members read series" ON reservation_series;
CREATE POLICY "Members read series" ON reservation_series
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = reservation_series.club_id
        AND m.user_id = auth.uid()
    )
  );
-- ============================================
-- CourtSheet AI — Phase 1 / Migration 005
-- `reservations` — the single source of truth for court time.
-- ============================================
-- *** REVIEW BEFORE APPLYING — this migration introduces the
--     no-double-booking EXCLUDE constraint. It depends on btree_gist from
--     migration 001. If 001 hasn't run, this fails. The constraint is the
--     entire reason CourtSheet's "the DB cannot be double-booked" promise
--     holds, so it's worth verifying it lands cleanly in prod. ***
--
-- One row = one atomic claim on one court for one [starts_at, ends_at)
-- range. Cancelled rows are excluded from the overlap check so freeing a
-- slot is a status change, not a delete.
--
-- `type`:    what is happening
-- `source`:  which subsystem created the row
-- `source_id`: FK into the originating tool's row (events.id, lesson_slots.id,
--              cc_events.id, quad_matches.id, etc.). Loosely typed UUID —
--              the source column tells you which table it points at.
-- `signups_open` + `signups_capacity`: opt-in surface for player/coach
--              "looking for N more" bookings. The signup join lives in
--              migration 006.
--
-- Safe to re-run.
-- ============================================

CREATE TABLE IF NOT EXISTS reservations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id       UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  court_id      UUID NOT NULL REFERENCES courts(id) ON DELETE RESTRICT,
  series_id     UUID REFERENCES reservation_series(id) ON DELETE SET NULL,

  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,

  type          TEXT NOT NULL
                  CHECK (type IN ('camp','lesson','event','match','member','maintenance','blackout','hold')),
  source        TEXT NOT NULL
                  CHECK (source IN ('manual','ai','lessons','mixer','courtconnect','tournaments','quads','jtt','import')),
  source_id     UUID,

  title         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'confirmed'
                  CHECK (status IN ('confirmed','tentative','cancelled')),
  color         TEXT,

  -- Opt-in: this reservation accepts player signups (clinic, doubles
  -- looking for 2 more, social, etc). Signup join in migration 006.
  signups_open      BOOLEAN NOT NULL DEFAULT false,
  signups_capacity  INT,
  -- Optional one-line cue the host wants signups to see
  -- ("Looking for 3 more for doubles", "Beginner clinic, all welcome").
  signups_pitch     TEXT,

  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_by    UUID NOT NULL REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (ends_at > starts_at),
  CHECK (signups_capacity IS NULL OR signups_capacity > 0)
);

-- The robustness linchpin.
-- Postgres rejects any INSERT/UPDATE that would put two non-cancelled
-- reservations on the same court with overlapping time ranges. Operates
-- at the data layer, so even a buggy application path can't double-book.
-- Requires btree_gist (migration 001).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'no_double_booking'
  ) THEN
    ALTER TABLE reservations
      ADD CONSTRAINT no_double_booking
      EXCLUDE USING gist (
        court_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
      ) WHERE (status <> 'cancelled');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reservations_club_time
  ON reservations(club_id, starts_at, ends_at)
  WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_reservations_court_time
  ON reservations(court_id, starts_at)
  WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_reservations_source
  ON reservations(source, source_id);
CREATE INDEX IF NOT EXISTS idx_reservations_series
  ON reservations(series_id) WHERE series_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reservations_signups_open
  ON reservations(club_id, starts_at)
  WHERE signups_open = true AND status = 'confirmed';

CREATE OR REPLACE FUNCTION touch_reservations_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reservations_updated_at ON reservations;
CREATE TRIGGER trg_reservations_updated_at
  BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION touch_reservations_updated_at();

ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

-- Members of the club can read all non-cancelled reservations.
DROP POLICY IF EXISTS "Club members read reservations" ON reservations;
CREATE POLICY "Club members read reservations" ON reservations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = reservations.club_id
        AND m.user_id = auth.uid()
    )
  );

-- Public can read any reservation at a public club that's open for signups.
-- This drives the unauthenticated /courtsheet/[clubSlug] view.
DROP POLICY IF EXISTS "Public reads open-signup reservations" ON reservations;
CREATE POLICY "Public reads open-signup reservations" ON reservations
  FOR SELECT USING (
    signups_open = true
    AND status = 'confirmed'
    AND EXISTS (
      SELECT 1 FROM cc_clubs c
      WHERE c.id = reservations.club_id AND c.is_public = true
    )
  );

-- Staff (owner/director/coach/front_desk) manage reservations.
-- Coaches can write but only for their own reservations is enforced in
-- the engine, not RLS — keeping RLS simple here and treating the engine
-- as the authoritative gatekeeper for cross-staff edits.
DROP POLICY IF EXISTS "Staff manage reservations" ON reservations;
CREATE POLICY "Staff manage reservations" ON reservations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = reservations.club_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner','director','coach','front_desk')
    )
  );
-- ============================================
-- CourtSheet AI — Phase 1 / Migration 006
-- `reservation_signups` — players joining open reservations.
-- ============================================
-- Powers three use cases (all the same underlying mechanism):
--   - Player Doubles: "I'm hitting at 6, need 3 more for doubles"
--   - Coach Clinic:    "Beginner clinic Friday 5pm, 6 slots"
--   - Director Social: "Friday-night social on courts 1-4, come if you can"
--
-- The reservation row itself owns `signups_open` and `signups_capacity`
-- (migration 005). This table is the per-player join.
--
-- Status flow:
--   requested  → freshly signed up
--   confirmed  → admitted (auto when under capacity, or staff-promoted from waitlist)
--   waitlist   → capacity full; bumps to confirmed when someone cancels
--   cancelled  → withdrew (kept for history; does not block re-signup)
--
-- Player identity: we accept either an auth.users.id (signed-in member) OR
-- a cc_vault_players.id (a director's PlayerVault entry the staff signs
-- someone up as) OR a free-text guest_name + guest_email (drop-in player).
-- At least one of {user_id, vault_player_id, guest_name+guest_email}
-- must be set — enforced by check constraint.
--
-- Safe to re-run.
-- ============================================

CREATE TABLE IF NOT EXISTS reservation_signups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reservation_id  UUID NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,

  -- One of these three identities must be present.
  user_id         UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  vault_player_id UUID,  -- NOT a hard FK; cc_vault_players may move/rename
  guest_name      TEXT,
  guest_email     TEXT,

  status          TEXT NOT NULL DEFAULT 'requested'
                    CHECK (status IN ('requested','confirmed','waitlist','cancelled')),
  note            TEXT,
  signed_up_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (
    user_id IS NOT NULL
    OR vault_player_id IS NOT NULL
    OR (guest_name IS NOT NULL AND guest_email IS NOT NULL)
  )
);

-- A given identity can only have one non-cancelled signup per reservation.
-- (Re-signup after cancel is allowed.)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_signup_user_per_reservation
  ON reservation_signups(reservation_id, user_id)
  WHERE user_id IS NOT NULL AND status <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS uniq_signup_vault_per_reservation
  ON reservation_signups(reservation_id, vault_player_id)
  WHERE vault_player_id IS NOT NULL AND status <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS uniq_signup_guest_per_reservation
  ON reservation_signups(reservation_id, guest_email)
  WHERE guest_email IS NOT NULL AND status <> 'cancelled';

CREATE INDEX IF NOT EXISTS idx_signups_reservation_status
  ON reservation_signups(reservation_id, status);
CREATE INDEX IF NOT EXISTS idx_signups_user
  ON reservation_signups(user_id) WHERE user_id IS NOT NULL;

ALTER TABLE reservation_signups ENABLE ROW LEVEL SECURITY;

-- A player can read + cancel their own signups.
DROP POLICY IF EXISTS "Players manage own signups" ON reservation_signups;
CREATE POLICY "Players manage own signups" ON reservation_signups
  FOR ALL USING (user_id = auth.uid());

-- Club staff manage all signups for their club's reservations.
DROP POLICY IF EXISTS "Staff manage all signups" ON reservation_signups;
CREATE POLICY "Staff manage all signups" ON reservation_signups
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM reservations r
      JOIN cc_club_members m ON m.club_id = r.club_id
      WHERE r.id = reservation_signups.reservation_id
        AND m.user_id = auth.uid()
        AND m.role IN ('owner','director','coach','front_desk')
    )
  );

-- Public can sign up for open reservations at public clubs. The engine
-- enforces capacity/waitlist transitions; this policy just admits the row.
DROP POLICY IF EXISTS "Public can sign up for open reservations" ON reservation_signups;
CREATE POLICY "Public can sign up for open reservations" ON reservation_signups
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM reservations r
      JOIN cc_clubs c ON c.id = r.club_id
      WHERE r.id = reservation_signups.reservation_id
        AND r.signups_open = true
        AND r.status = 'confirmed'
        AND c.is_public = true
    )
  );

CREATE OR REPLACE FUNCTION touch_signup_status_changed_at() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_signup_status_changed ON reservation_signups;
CREATE TRIGGER trg_signup_status_changed
  BEFORE UPDATE ON reservation_signups
  FOR EACH ROW EXECUTE FUNCTION touch_signup_status_changed_at();
-- ============================================
-- CourtSheet AI — Phase 1 / Migration 007
-- `courtsheet_audit_log` — who/what/when for every plan.
-- ============================================
-- Every preview the AI generates, every confirm, every manual UI edit
-- writes one row. The diff field holds the reverse-plan so Undo can
-- replay it even months later.
--
-- The two action verbs matter:
--   plan_previewed   — model emitted a Plan; nothing was written
--   plan_applied     — Plan was confirmed and committed in a transaction
--   plan_rejected    — user dismissed the preview
--   reservation_edit — direct UI edit (drag/resize/click-edit, no AI)
--   signup_added / signup_cancelled / signup_promoted
--
-- Safe to re-run.
-- ============================================

CREATE TABLE IF NOT EXISTS courtsheet_audit_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id         UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  actor_user_id   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action          TEXT NOT NULL
                    CHECK (action IN (
                      'plan_previewed','plan_applied','plan_rejected',
                      'reservation_edit','reservation_cancel',
                      'signup_added','signup_cancelled','signup_promoted'
                    )),
  -- The structured intent the AI emitted (if AI-sourced).
  intent          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Full diff: { created: [...], modified: [...], cancelled: [...], reverse: {...} }.
  -- `reverse` is what Undo replays.
  diff            JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Stable id so a preview row pairs with its applied/rejected follow-up.
  plan_id         UUID,
  -- Source channel: 'ai' (the command widget), 'ui' (manual sheet edit),
  -- 'api' (an external/tool integration), 'cron'.
  channel         TEXT NOT NULL DEFAULT 'ui'
                    CHECK (channel IN ('ai','ui','api','cron')),
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_club_time ON courtsheet_audit_log(club_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_plan ON courtsheet_audit_log(plan_id) WHERE plan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_actor ON courtsheet_audit_log(actor_user_id, created_at DESC);

ALTER TABLE courtsheet_audit_log ENABLE ROW LEVEL SECURITY;

-- Anyone in the club can read its audit log.
DROP POLICY IF EXISTS "Club members read audit" ON courtsheet_audit_log;
CREATE POLICY "Club members read audit" ON courtsheet_audit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM cc_club_members m
      WHERE m.club_id = courtsheet_audit_log.club_id
        AND m.user_id = auth.uid()
    )
  );

-- Service role writes audit rows. Authenticated users cannot insert
-- directly — the engine inserts via the admin client.
DROP POLICY IF EXISTS "No direct audit inserts" ON courtsheet_audit_log;
CREATE POLICY "No direct audit inserts" ON courtsheet_audit_log
  FOR INSERT WITH CHECK (false);
-- ============================================
-- CourtSheet AI — Phase 1 / Migration 008
-- Future-only backfill scaffolding.
-- ============================================
-- Per the build decision (Q6), we do NOT historical-import existing
-- events into reservations. This file ships only the helper FUNCTIONS
-- that future Phase 3 tool adapters use, plus a no-op comment block
-- explaining the policy.
--
-- No data is moved by this migration.
--
-- The actual write-through wiring per tool ships in Phase 3:
--   - MixerMode: events → reservation on schedule/edit/cancel
--   - Quads:     quad_matches → reservation per match
--   - Tournaments: tournament_matches → reservation per match
--   - JTT:       league_team_matchups → reservation per matchup
--   - CourtConnect: cc_events → reservation, cc_event_players synced with
--                   reservation_signups
--   - LessonsMode: lesson_slots gets a court_id, then on-create writes a
--                   reservation
--
-- Safe to re-run.
-- ============================================

-- Helper: resolve a court label (e.g. '1', '5', 'Stadium') against a
-- club's courts table. Returns NULL if no match — adapters should treat
-- that as "skip this row, log a warning" rather than create a reservation
-- against the wrong court.
CREATE OR REPLACE FUNCTION courtsheet_resolve_court(
  p_club_id UUID,
  p_label   TEXT
) RETURNS UUID AS $$
DECLARE
  v_court_id UUID;
BEGIN
  -- Try match by name first (covers "Stadium", "Bubble", etc).
  SELECT id INTO v_court_id
  FROM courts
  WHERE club_id = p_club_id
    AND status <> 'hidden'
    AND name = p_label
  LIMIT 1;

  IF v_court_id IS NOT NULL THEN
    RETURN v_court_id;
  END IF;

  -- Fall back to numeric match ("1", "5", etc).
  BEGIN
    SELECT id INTO v_court_id
    FROM courts
    WHERE club_id = p_club_id
      AND status <> 'hidden'
      AND number = p_label::INT
    LIMIT 1;
  EXCEPTION
    WHEN invalid_text_representation THEN
      v_court_id := NULL;
  END;

  RETURN v_court_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- Helper: idempotent reservation upsert for adapters. Adapters call this
-- with their tool's (source, source_id) pair and we either insert a new
-- reservation or update the existing one. Returns the reservation id.
CREATE OR REPLACE FUNCTION courtsheet_upsert_reservation(
  p_club_id     UUID,
  p_court_id    UUID,
  p_starts_at   TIMESTAMPTZ,
  p_ends_at     TIMESTAMPTZ,
  p_type        TEXT,
  p_source      TEXT,
  p_source_id   UUID,
  p_title       TEXT,
  p_created_by  UUID,
  p_meta        JSONB DEFAULT '{}'::jsonb
) RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Look for an existing reservation that came from this source row.
  SELECT id INTO v_id
  FROM reservations
  WHERE source = p_source
    AND source_id = p_source_id
    AND status <> 'cancelled'
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE reservations
       SET court_id   = p_court_id,
           starts_at  = p_starts_at,
           ends_at    = p_ends_at,
           type       = p_type,
           title      = p_title,
           meta       = p_meta,
           updated_at = NOW()
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  INSERT INTO reservations (
    club_id, court_id, starts_at, ends_at,
    type, source, source_id, title, created_by, meta
  ) VALUES (
    p_club_id, p_court_id, p_starts_at, p_ends_at,
    p_type, p_source, p_source_id, p_title, p_created_by, p_meta
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION courtsheet_upsert_reservation IS
  'Idempotent reservation upsert keyed by (source, source_id). Phase 3 tool '
  'adapters call this. Raises on EXCLUDE-constraint conflict — adapters '
  'are expected to detect & report conflicts before calling.';
-- ============================================
-- CourtSheet AI — Phase 1 / Migration 009
-- Seed: Sleepy Hollow Swim & Tennis Club + 8 courts.
-- ============================================
-- Dogfood club. Idempotent: safe to re-run.
--
-- Owner: darrinjco@gmail.com — resolved by email lookup against auth.users.
--
-- Operating hours: weekdays 6 AM – 10 PM; weekends 7 AM – 9 PM.
-- (Edit in the cc_clubs row or via the Settings UI once it ships.)
--
-- Courts: 8 outdoor hard courts numbered 1-8, tennis-only by default.
-- Re-label in the admin UI if any are pickleball-shared or have friendly
-- names like "Stadium".
-- ============================================

DO $$
DECLARE
  v_owner_id UUID;
  v_club_id  UUID;
BEGIN
  -- Resolve owner.
  SELECT id INTO v_owner_id
  FROM auth.users
  WHERE email = 'darrinjco@gmail.com'
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    RAISE NOTICE 'Sleepy Hollow seed skipped: no auth.users row for darrinjco@gmail.com';
    RETURN;
  END IF;

  -- Upsert the club.
  INSERT INTO cc_clubs (
    owner_id, name, slug, description,
    sports, is_public, timezone, operating_hours
  ) VALUES (
    v_owner_id,
    'Sleepy Hollow Swim & Tennis Club',
    'sleepy-hollow',
    'Private club in Orinda, CA. Founded 1955.',
    ARRAY['tennis']::TEXT[],
    true,
    'America/Los_Angeles',
    jsonb_build_object(
      '0', jsonb_build_array(jsonb_build_object('open','07:00','close','21:00')), -- Sun
      '1', jsonb_build_array(jsonb_build_object('open','06:00','close','22:00')), -- Mon
      '2', jsonb_build_array(jsonb_build_object('open','06:00','close','22:00')), -- Tue
      '3', jsonb_build_array(jsonb_build_object('open','06:00','close','22:00')), -- Wed
      '4', jsonb_build_array(jsonb_build_object('open','06:00','close','22:00')), -- Thu
      '5', jsonb_build_array(jsonb_build_object('open','06:00','close','22:00')), -- Fri
      '6', jsonb_build_array(jsonb_build_object('open','07:00','close','21:00'))  -- Sat
    )
  )
  ON CONFLICT (slug) DO UPDATE
    SET timezone = EXCLUDED.timezone,
        operating_hours = EXCLUDED.operating_hours
  RETURNING id INTO v_club_id;

  -- Owner membership (migration 002 also mirrors owners, but be explicit).
  INSERT INTO cc_club_members (club_id, user_id, role)
  VALUES (v_club_id, v_owner_id, 'owner')
  ON CONFLICT (club_id, user_id) DO UPDATE SET role = 'owner';

  -- 8 courts.
  INSERT INTO courts (club_id, number, sports, surface, indoor, display_order)
  SELECT v_club_id, n, ARRAY['tennis']::TEXT[], 'hard', false, n
  FROM generate_series(1, 8) AS n
  ON CONFLICT (club_id, number) DO NOTHING;
END $$;
-- ============================================
-- CourtSheet AI — Phase 3 / Migration 010
-- lesson_slots.court_id (nullable FK).
-- ============================================
-- Lets a coach optionally pin a slot to a specific court. When set, the
-- lessons adapter (src/lib/courtsheet/adapters/lessons.ts) writes a
-- reservation for that court at slot creation time. When null, the slot
-- behaves exactly as it does today — no CourtSheet integration.
--
-- *** REVIEW BEFORE APPLYING — this migration ALTERS an existing live
--     table (lesson_slots). The new column is nullable with no default,
--     so existing rows are unaffected. ***
--
-- Safe to re-run.
-- ============================================

ALTER TABLE lesson_slots
  ADD COLUMN IF NOT EXISTS court_id UUID REFERENCES courts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lesson_slots_court ON lesson_slots(court_id)
  WHERE court_id IS NOT NULL;
-- ============================================
-- CourtSheet AI — Phase 5 / Migration 011
-- Enable Supabase realtime on reservations + signups.
-- ============================================
-- Drives the live grid: two staff with the sheet open see each other's
-- changes within ~500ms, without polling. Idempotent — each ALTER
-- PUBLICATION is gated by a pg_publication_tables check so re-running
-- this migration on an already-configured database is a no-op.
--
-- Safe to re-run.
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'reservations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reservations;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'reservation_signups'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reservation_signups;
  END IF;
END $$;
