-- ============================================
-- Paid court booking, with time-of-day pricing.
-- ============================================
-- Two tables:
--
--   court_rate_cards  what an hour costs, by who you are and when you play
--   court_bookings    who booked it and what they owe
--
-- WHY NOT PUT THE PRICE ON `reservations`. reservations is the single source of
-- truth for court TIME, with the no_double_booking EXCLUDE constraint as its
-- whole point, and it is written by six different subsystems (AI planner,
-- lessons, mixer, tournaments, quads, import). Hanging a booker's name, email
-- and payment status off it would put a stranger's contact details on every
-- blackout and maintenance row in the club. So a booking POINTS AT its
-- reservation and keeps the commerce beside it — the same split as
-- club_programs and club_program_registrations.
--
-- Times and dates stay on `reservations` and are read through the join. They
-- are deliberately NOT copied here: two copies of a booking's start time is one
-- more than can be kept true.
--
-- Safe to re-run.
-- ============================================

-- --------------------------------------------
-- court_rate_cards
-- --------------------------------------------
-- One row per (audience x slice of the week). A club that charges nothing to
-- members and $24 an hour to the public at all times needs two rows; a club
-- with peak and off-peak needs four.
CREATE TABLE IF NOT EXISTS court_rate_cards (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id       UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,

  -- Who this rate is for. 'member' applies to a signed-in club member;
  -- 'public' to everyone else. Deliberately not self-declared at booking time
  -- — a free-courts checkbox on a public form is a free-courts checkbox.
  applies_to    TEXT NOT NULL CHECK (applies_to IN ('member','public')),

  -- When it applies, in CLUB-LOCAL terms. Postgres DOW: 0=Sun..6=Sat.
  -- Empty days_of_week means every day.
  days_of_week  INT[] NOT NULL DEFAULT '{}',
  time_start    TIME NOT NULL DEFAULT '00:00',
  time_end      TIME NOT NULL DEFAULT '23:59',

  -- PER HOUR. A 90-minute booking is priced pro-rata, and a booking that
  -- straddles two windows is priced per segment — see lib/courts/pricing.ts.
  price_cents   INT NOT NULL DEFAULT 0,

  -- How far ahead this audience may book. The rule Lafayette already runs:
  -- members 7 days, public 3.
  advance_days  INT NOT NULL DEFAULT 7,

  -- Booking length limits, in minutes. Null means the club does not care.
  min_minutes   INT,
  max_minutes   INT,

  active        BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INT NOT NULL DEFAULT 0,
  note          TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (time_end > time_start),
  CHECK (price_cents >= 0),
  CHECK (advance_days >= 0),
  CHECK (min_minutes IS NULL OR min_minutes > 0),
  CHECK (max_minutes IS NULL OR min_minutes IS NULL OR max_minutes >= min_minutes)
);

CREATE INDEX IF NOT EXISTS idx_court_rate_cards_club
  ON court_rate_cards(club_id, applies_to, display_order);

-- --------------------------------------------
-- court_bookings
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS court_bookings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id         UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  -- The claim on the court. Cascades: cancelling the court time cancels the
  -- booking, because a booking without court time is not a thing.
  reservation_id  UUID NOT NULL UNIQUE REFERENCES reservations(id) ON DELETE CASCADE,
  court_id        UUID NOT NULL REFERENCES courts(id) ON DELETE RESTRICT,

  booker_name     TEXT NOT NULL,
  booker_email    TEXT NOT NULL,
  booker_phone    TEXT,
  -- Set when a signed-in member booked, so a club can see at a glance which
  -- bookings were member time and which were revenue.
  booker_user_id  UUID,
  rate_applied    TEXT NOT NULL CHECK (rate_applied IN ('member','public')),

  minutes         INT NOT NULL,
  amount_cents    INT NOT NULL DEFAULT 0,
  -- What the price was made of, for a receipt and for an argument about it
  -- later: [{label, minutes, price_cents_per_hour, cents}].
  price_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,

  payment_status  TEXT NOT NULL DEFAULT 'pending'
                    CHECK (payment_status IN ('pending','paid','waived','refunded')),
  payment_ref     TEXT,

  status          TEXT NOT NULL DEFAULT 'booked'
                    CHECK (status IN ('booked','cancelled')),
  notes           TEXT,
  -- How a stranger cancels their own booking without an account. Random,
  -- unguessable, and the only thing that authorises it.
  cancel_token    TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (minutes > 0),
  CHECK (amount_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_court_bookings_club ON court_bookings(club_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_court_bookings_email ON court_bookings(club_id, lower(booker_email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_court_bookings_cancel_token
  ON court_bookings(cancel_token);

-- --------------------------------------------
-- updated_at
-- --------------------------------------------
CREATE OR REPLACE FUNCTION touch_court_booking_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_court_rate_cards_updated_at ON court_rate_cards;
CREATE TRIGGER trg_court_rate_cards_updated_at
  BEFORE UPDATE ON court_rate_cards
  FOR EACH ROW EXECUTE FUNCTION touch_court_booking_updated_at();

DROP TRIGGER IF EXISTS trg_court_bookings_updated_at ON court_bookings;
CREATE TRIGGER trg_court_bookings_updated_at
  BEFORE UPDATE ON court_bookings
  FOR EACH ROW EXECUTE FUNCTION touch_court_booking_updated_at();

-- --------------------------------------------
-- RLS
-- --------------------------------------------
-- Rate cards are PUBLIC to read: they are a published price list, and the
-- booking page has to show them to someone who is not logged in. Staff write.
--
-- Bookings are readable by staff only. They carry a stranger's name, email and
-- phone; the booker themselves gets back to their booking through the cancel
-- token, not through a policy. Public booking is an INSERT through a
-- service-role route, because a policy cannot check the club's operating hours,
-- the advance-booking window, or compute what is owed.

ALTER TABLE court_rate_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS court_rate_cards_public_read ON court_rate_cards;
CREATE POLICY court_rate_cards_public_read ON court_rate_cards
  FOR SELECT USING (
    active
    AND EXISTS (SELECT 1 FROM cc_clubs c WHERE c.id = court_rate_cards.club_id AND c.is_public)
  );

DROP POLICY IF EXISTS court_rate_cards_staff_all ON court_rate_cards;
CREATE POLICY court_rate_cards_staff_all ON court_rate_cards
  FOR ALL USING (is_club_team(club_id));

DROP POLICY IF EXISTS court_rate_cards_owner_all ON court_rate_cards;
CREATE POLICY court_rate_cards_owner_all ON court_rate_cards
  FOR ALL USING (
    EXISTS (SELECT 1 FROM cc_clubs c WHERE c.id = court_rate_cards.club_id AND c.owner_id = auth.uid())
  );

ALTER TABLE court_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS court_bookings_staff_all ON court_bookings;
CREATE POLICY court_bookings_staff_all ON court_bookings
  FOR ALL USING (is_club_team(club_id));

DROP POLICY IF EXISTS court_bookings_owner_all ON court_bookings;
CREATE POLICY court_bookings_owner_all ON court_bookings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM cc_clubs c WHERE c.id = court_bookings.club_id AND c.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS court_bookings_own_read ON court_bookings;
CREATE POLICY court_bookings_own_read ON court_bookings
  FOR SELECT USING (booker_user_id IS NOT NULL AND booker_user_id = auth.uid());

COMMENT ON TABLE court_rate_cards IS
  'What an hour of court time costs, by audience and slice of the week. Public '
  'price list — readable by anyone, written by staff. Priced per hour and '
  'pro-rated; see lib/courts/pricing.ts for straddled windows.';
COMMENT ON TABLE court_bookings IS
  'Who booked a court and what they owe. Points at the reservations row that '
  'holds the actual court time; times are read through that join, never copied.';
COMMENT ON COLUMN court_bookings.cancel_token IS
  'How a booker with no account cancels their own booking. Unguessable, and the '
  'only thing that authorises it.';
