-- ============================================
-- How a club gets paid.
-- ============================================
-- One row per club. Two things in it:
--
--   1. A PAYMENT LINK the club already has — its own Square, Stripe, PayPal or
--      Venmo checkout. This works today, and it is how every club that is not
--      the one Square-connected account already takes money in this app.
--
--   2. A slot for a real per-club processor connection (Square or Stripe), so
--      money can one day move without a hand-off. Deliberately recorded as
--      'disconnected' until the OAuth app credentials exist — the UI says which
--      state it is in rather than showing a button that quietly does nothing.
--
-- WHY CLUB-LEVEL AT ALL. club_programs.external_payment_url already exists, but
-- a club with five classes was pasting the same Square link five times, and
-- court bookings had nowhere to put one at all — so a public booker was told to
-- pay at the desk even by a club that takes cards online every day. A default
-- here, inherited where a class has nothing of its own, is one paste instead of
-- six and it turns court bookings into something payable.
--
-- Safe to re-run.
-- ============================================

CREATE TABLE IF NOT EXISTS club_payments (
  club_id             UUID PRIMARY KEY REFERENCES cc_clubs(id) ON DELETE CASCADE,

  -- The club's own checkout. Validated with the same isPaymentLink() the event
  -- forms use, so "what counts as a payment link" means one thing app-wide.
  payment_link        TEXT,
  -- What the button says. A club whose link is Venmo should not have a button
  -- reading "Pay by card".
  payment_link_label  TEXT,
  -- Shown under the button: "Pay within 48 hours to keep your spot", etc.
  payment_note        TEXT,

  -- Where the link is offered. A club may want it on class sign-ups but not on
  -- casual court time, or the reverse.
  link_on_programs    BOOLEAN NOT NULL DEFAULT TRUE,
  link_on_courts      BOOLEAN NOT NULL DEFAULT TRUE,

  -- The processor slot. 'none' until a club connects one.
  provider            TEXT NOT NULL DEFAULT 'none'
                        CHECK (provider IN ('none','square','stripe')),
  provider_status     TEXT NOT NULL DEFAULT 'disconnected'
                        CHECK (provider_status IN ('disconnected','pending','connected','revoked')),
  -- The merchant/account id at the provider. Never a token: access tokens do
  -- not belong in a table read by page code, and nothing here needs one yet.
  provider_account_id TEXT,
  connected_at        TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION touch_club_payments_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_club_payments_updated_at ON club_payments;
CREATE TRIGGER trg_club_payments_updated_at
  BEFORE UPDATE ON club_payments
  FOR EACH ROW EXECUTE FUNCTION touch_club_payments_updated_at();

-- --------------------------------------------
-- RLS
-- --------------------------------------------
-- Staff manage. NOT public: the payment LINK is public by nature — it goes in
-- confirmation emails and onto receipt pages — but it is served through
-- server-rendered pages and service-role routes, so nothing needs to read this
-- table with an anon key. Keeping it closed means the provider account id and
-- the club's internal notes are not one bad policy away from being listable.
ALTER TABLE club_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS club_payments_staff_all ON club_payments;
CREATE POLICY club_payments_staff_all ON club_payments
  FOR ALL USING (is_club_team(club_id));

DROP POLICY IF EXISTS club_payments_owner_all ON club_payments;
CREATE POLICY club_payments_owner_all ON club_payments
  FOR ALL USING (
    EXISTS (SELECT 1 FROM cc_clubs c WHERE c.id = club_payments.club_id AND c.owner_id = auth.uid())
  );

COMMENT ON TABLE club_payments IS
  'How a club gets paid: its own checkout link (works today, inherited by '
  'classes and court bookings), plus a slot for a per-club Square/Stripe '
  'connection that is recorded as disconnected until the OAuth app exists.';
COMMENT ON COLUMN club_payments.provider_account_id IS
  'Merchant/account id at the provider. Never an access token — those do not '
  'belong in a table page code reads.';
