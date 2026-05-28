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
