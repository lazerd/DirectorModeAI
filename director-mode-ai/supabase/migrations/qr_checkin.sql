-- ============================================
-- QR Check-In: walk-on court time, wait lists, and pool gate sign-in.
-- ============================================
-- Replaces the paper court register on the fence and the clipboard at the
-- pool gate. A printed QR per court (and one per pool gate / kiosk) opens a
-- phone page with no login; scanning starts the group's play timer.
--
-- Four tables:
--
--   checkin_settings  the club's rules (time limits, min players, grace ...)
--   checkin_spaces    every scannable thing: a court, the kiosk, a pool gate
--   checkin_sessions  a group actually using a space (playing / in the pool)
--   checkin_waits     the wait list, in register order
--
-- WHY COURTS ARE NOT GIVEN A TOKEN COLUMN. `courts` stays the one list of
-- courts; a court's check-in row POINTS AT it (court_id) and carries the sign
-- token and any per-court rule overrides. The same table holds spaces that are
-- not courts at all (pool gate, lap lanes, fitness room), so there is one token
-- lookup and one "rotate the sign" button for all of them.
--
-- WHY WALK-ON PLAY IS NOT A `reservations` ROW. reservations is the court
-- sheet's source of truth for BOOKED time, guarded by no_double_booking. A
-- walk-on session is a different animal:
--   * its end is not known when it starts. "Doubles, 90 minutes" is only a
--     limit when somebody is waiting; with nobody waiting a group plays on, and
--     "We're done" frees the court early. A reservation needs a fixed range.
--   * it carries a group's names, device and email; a reservation row is read
--     by every staff grid and adapter in the app.
--   * a pool visit is not court time at all, and many groups share the space.
-- So sessions live here. A club that wants walk-on play visible on the staff
-- grid turns on `mirror_to_courtsheet`, and each court session then also
-- writes a plain reservation (type 'member', source 'manual',
-- meta.origin = 'checkin') that is trimmed when the group leaves. The check-in
-- engine ignores its own mirrors when it looks for real bookings.
--
-- Everything public goes through service-role routes that validate the sign
-- token themselves, so RLS here is staff-only.
--
-- Safe to re-run.
-- ============================================

-- --------------------------------------------
-- checkin_settings: one row per club. Defaults are Rossmoor's court register
-- rules (singles 1h, doubles 1.5h, only when others are waiting, 2 players).
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS checkin_settings (
  club_id                   UUID PRIMARY KEY REFERENCES cc_clubs(id) ON DELETE CASCADE,
  enabled                   BOOLEAN NOT NULL DEFAULT TRUE,

  singles_minutes           INT NOT NULL DEFAULT 60,
  doubles_minutes           INT NOT NULL DEFAULT 90,
  other_minutes             INT NOT NULL DEFAULT 60,
  -- Rossmoor: "limits apply when others are waiting". Off means the limit
  -- always applies.
  limits_only_when_waiting  BOOLEAN NOT NULL DEFAULT TRUE,
  min_players               INT NOT NULL DEFAULT 2,
  -- Bumped players "finish the current point": how long after the limit a
  -- group with people waiting is ended automatically.
  grace_minutes             INT NOT NULL DEFAULT 5,
  -- How long a waiting group has to walk over and start once offered a court.
  claim_minutes             INT NOT NULL DEFAULT 10,
  -- With nobody waiting, a session still ends here (or at club closing).
  max_session_minutes       INT NOT NULL DEFAULT 180,

  mirror_to_courtsheet      BOOLEAN NOT NULL DEFAULT FALSE,

  -- Prime time, club-local. Used by the insights ("full 92% of prime time").
  prime_start               TIME NOT NULL DEFAULT '07:00',
  prime_end                 TIME NOT NULL DEFAULT '11:00',

  -- Optional "must be at the club" check. Off by default: a phone's location
  -- is often wrong by a block, and a senior who says no to the location prompt
  -- should still be able to play.
  geofence_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  latitude                  DOUBLE PRECISION,
  longitude                 DOUBLE PRECISION,
  geofence_meters           INT NOT NULL DEFAULT 400,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (singles_minutes > 0 AND doubles_minutes > 0 AND other_minutes > 0),
  CHECK (min_players >= 1),
  CHECK (grace_minutes >= 0 AND claim_minutes > 0),
  CHECK (max_session_minutes > 0),
  CHECK (geofence_meters > 0)
);

-- --------------------------------------------
-- checkin_spaces
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS checkin_spaces (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id                   UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  -- court: one court, one group at a time.  kiosk: the complex wait-list sign.
  -- pool / room / other: a shared space with a headcount.
  kind                      TEXT NOT NULL CHECK (kind IN ('court','kiosk','pool','room','other')),
  court_id                  UUID UNIQUE REFERENCES courts(id) ON DELETE CASCADE,
  name                      TEXT NOT NULL,

  -- What the printed QR carries. Unguessable, short enough to type from the
  -- sign, and replaced by "reprint" so a torn-down sign stops working.
  token                     TEXT NOT NULL UNIQUE,
  token_rotated_at          TIMESTAMPTZ,

  -- Per-space overrides. NULL means "use the club's rule".
  singles_minutes           INT,
  doubles_minutes           INT,
  other_minutes             INT,
  limits_only_when_waiting  BOOLEAN,
  min_players               INT,

  -- Shared spaces.
  capacity                  INT,
  track_guests              BOOLEAN NOT NULL DEFAULT FALSE,
  guest_names_required      BOOLEAN NOT NULL DEFAULT FALSE,

  active                    BOOLEAN NOT NULL DEFAULT TRUE,
  display_order             INT NOT NULL DEFAULT 0,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK ((kind = 'court') = (court_id IS NOT NULL)),
  CHECK (capacity IS NULL OR capacity > 0),
  CHECK (min_players IS NULL OR min_players >= 1)
);

CREATE INDEX IF NOT EXISTS idx_checkin_spaces_club ON checkin_spaces(club_id, display_order);
-- One kiosk (wait-list) sign per club.
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkin_spaces_one_kiosk
  ON checkin_spaces(club_id) WHERE kind = 'kiosk';

-- --------------------------------------------
-- checkin_sessions
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS checkin_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id         UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  space_id        UUID NOT NULL REFERENCES checkin_spaces(id) ON DELETE CASCADE,
  -- TRUE for a court (one group at a time), FALSE for a pool visit. Copied
  -- from the space so the unique index below can enforce it.
  exclusive       BOOLEAN NOT NULL DEFAULT TRUE,

  play_type       TEXT NOT NULL CHECK (play_type IN ('singles','doubles','other','visit')),
  -- [{ "name": "Mary Benin", "user_id": "..."? }]
  players         JSONB NOT NULL DEFAULT '[]'::jsonb,
  player_count    INT NOT NULL,
  guest_count     INT NOT NULL DEFAULT 0,
  guest_names     TEXT[] NOT NULL DEFAULT '{}',
  contact_email   TEXT,
  user_id         UUID,

  -- The group's phone page. Random and the only thing that authorises
  -- "We're done" / "Add a player" for a group with no account.
  group_token     TEXT NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex'),

  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- When the play-type limit runs out. NULL for a pool visit.
  limit_ends_at   TIMESTAMPTZ,
  -- The latest this session can run: max length, club closing, or the start
  -- of the next booking on the court, whichever is first.
  hard_ends_at    TIMESTAMPTZ NOT NULL,
  ended_at        TIMESTAMPTZ,
  end_reason      TEXT CHECK (end_reason IN ('done','limit','max','block','staff','bumped','checkout')),

  wait_id         UUID,
  reservation_id  UUID REFERENCES reservations(id) ON DELETE SET NULL,
  device_hash     TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (player_count >= 1 AND guest_count >= 0),
  CHECK (hard_ends_at > started_at)
);

CREATE INDEX IF NOT EXISTS idx_checkin_sessions_club_time ON checkin_sessions(club_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkin_sessions_active ON checkin_sessions(club_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkin_sessions_group_token ON checkin_sessions(group_token);
-- The race guard, same job as no_double_booking: two groups scanning Court 4
-- at the same second cannot both start. One INSERT wins, the other gets 23505.
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkin_sessions_one_per_court
  ON checkin_sessions(space_id) WHERE status = 'active' AND exclusive;

-- --------------------------------------------
-- checkin_waits
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS checkin_waits (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id             UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  -- The sign they scanned to join (a busy court, or the kiosk). Any court
  -- can be offered; this is for the record.
  joined_via_space_id UUID REFERENCES checkin_spaces(id) ON DELETE SET NULL,

  play_type           TEXT NOT NULL CHECK (play_type IN ('singles','doubles','other')),
  players             JSONB NOT NULL DEFAULT '[]'::jsonb,
  player_count        INT NOT NULL,
  contact_email       TEXT,
  user_id             UUID,
  group_token         TEXT NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex'),

  -- waiting -> offered -> playing, or left / missed (offer ran out) / expired.
  status              TEXT NOT NULL DEFAULT 'waiting'
                        CHECK (status IN ('waiting','offered','playing','left','missed','expired','removed')),
  joined_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  offered_space_id    UUID REFERENCES checkin_spaces(id) ON DELETE SET NULL,
  offered_at          TIMESTAMPTZ,
  offer_expires_at    TIMESTAMPTZ,
  offer_notified_at   TIMESTAMPTZ,
  resolved_at         TIMESTAMPTZ,
  session_id          UUID REFERENCES checkin_sessions(id) ON DELETE SET NULL,
  device_hash         TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (player_count >= 1)
);

CREATE INDEX IF NOT EXISTS idx_checkin_waits_open ON checkin_waits(club_id, joined_at)
  WHERE status IN ('waiting','offered');
CREATE INDEX IF NOT EXISTS idx_checkin_waits_club_time ON checkin_waits(club_id, joined_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkin_waits_group_token ON checkin_waits(group_token);
-- A court is held for one waiting group at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkin_waits_one_offer_per_space
  ON checkin_waits(offered_space_id) WHERE status = 'offered';

-- --------------------------------------------
-- updated_at
-- --------------------------------------------
CREATE OR REPLACE FUNCTION touch_checkin_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_checkin_settings_updated_at ON checkin_settings;
CREATE TRIGGER trg_checkin_settings_updated_at BEFORE UPDATE ON checkin_settings
  FOR EACH ROW EXECUTE FUNCTION touch_checkin_updated_at();
DROP TRIGGER IF EXISTS trg_checkin_spaces_updated_at ON checkin_spaces;
CREATE TRIGGER trg_checkin_spaces_updated_at BEFORE UPDATE ON checkin_spaces
  FOR EACH ROW EXECUTE FUNCTION touch_checkin_updated_at();
DROP TRIGGER IF EXISTS trg_checkin_sessions_updated_at ON checkin_sessions;
CREATE TRIGGER trg_checkin_sessions_updated_at BEFORE UPDATE ON checkin_sessions
  FOR EACH ROW EXECUTE FUNCTION touch_checkin_updated_at();
DROP TRIGGER IF EXISTS trg_checkin_waits_updated_at ON checkin_waits;
CREATE TRIGGER trg_checkin_waits_updated_at BEFORE UPDATE ON checkin_waits
  FOR EACH ROW EXECUTE FUNCTION touch_checkin_updated_at();

-- --------------------------------------------
-- RLS: staff only. Names, emails and devices are PII; is_club_member() is
-- deliberately NOT used (it includes plain members). The public scan pages and
-- board read through service-role routes that trim names to "Mary B.".
-- --------------------------------------------
ALTER TABLE checkin_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkin_spaces   ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkin_waits    ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['checkin_settings','checkin_spaces','checkin_sessions','checkin_waits'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_staff_all', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (is_club_team(club_id)) WITH CHECK (is_club_team(club_id))', t || '_staff_all', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (EXISTS (SELECT 1 FROM cc_clubs c WHERE c.id = %I.club_id AND c.owner_id = auth.uid()))',
      t || '_owner_all', t, t);
  END LOOP;
END $$;

COMMENT ON TABLE checkin_spaces IS
  'Every scannable QR sign: a court (points at courts), the kiosk wait-list sign, '
  'or a shared space like a pool gate. token is what the printed QR carries.';
COMMENT ON TABLE checkin_sessions IS
  'A group using a space right now (or in the past). Walk-on court time lives '
  'here, not in reservations, because its end is not known when it starts; see '
  'mirror_to_courtsheet for the optional reservation copy.';
COMMENT ON TABLE checkin_waits IS
  'The wait list, in register order (joined_at). A freed or over-limit court is '
  'offered to the first waiting group for claim_minutes.';
