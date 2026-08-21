-- ============================================
-- Quads: comp / discount codes
-- ============================================
-- Lets a director hand out free or discounted entries without ever gating on
-- a player's NAME — a code is something the family holds, so there's no chance
-- of comping the wrong "Cohen". A code is scoped to one event or to a whole
-- series (both dates of the Dunkin' Quads share one code).
--
-- Locked to the service role: RLS is on with no permissive policies, so only
-- the server routes (register / director APIs) can read or claim a code. That
-- keeps the code list out of the public page's reach.
--
-- Safe to re-run.
-- ============================================

CREATE TABLE IF NOT EXISTS quad_coupons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  code TEXT NOT NULL,
  -- Scope: exactly one of these should be set. event_id wins if both are.
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,
  series_slug TEXT,

  -- Who it's for, for the director's own records. Never used for matching.
  label TEXT,

  discount_percent INTEGER NOT NULL DEFAULT 100
    CHECK (discount_percent BETWEEN 1 AND 100),
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One code per scope. COALESCE keeps event-scoped and series-scoped codes from
-- colliding while still rejecting a duplicate inside the same scope.
CREATE UNIQUE INDEX IF NOT EXISTS idx_quad_coupons_code_scope
  ON quad_coupons (upper(code), COALESCE(event_id::text, series_slug, '*'));

DROP TRIGGER IF EXISTS trg_quad_coupons_touch ON quad_coupons;
CREATE TRIGGER trg_quad_coupons_touch
  BEFORE UPDATE ON quad_coupons
  FOR EACH ROW EXECUTE FUNCTION touch_quad_updated_at();

ALTER TABLE quad_coupons ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: service role only.

ALTER TABLE quad_entries
  ADD COLUMN IF NOT EXISTS coupon_code TEXT,
  ADD COLUMN IF NOT EXISTS discount_percent INTEGER
    CHECK (discount_percent IS NULL OR discount_percent BETWEEN 1 AND 100);

CREATE INDEX IF NOT EXISTS idx_quad_entries_coupon ON quad_entries(coupon_code)
  WHERE coupon_code IS NOT NULL;

-- Atomic claim: the guard lives in the UPDATE, so two simultaneous claims on a
-- single-use code can never both succeed. Returns TRUE if a use was reserved.
CREATE OR REPLACE FUNCTION claim_quad_coupon(p_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  claimed BOOLEAN := FALSE;
BEGIN
  UPDATE quad_coupons
     SET used_count = used_count + 1
   WHERE id = p_id
     AND active
     AND used_count < max_uses
  RETURNING TRUE INTO claimed;
  RETURN COALESCE(claimed, FALSE);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION release_quad_coupon(p_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE quad_coupons
     SET used_count = GREATEST(0, used_count - 1)
   WHERE id = p_id;
END;
$$ LANGUAGE plpgsql;
