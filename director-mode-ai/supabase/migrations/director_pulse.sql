-- ============================================
-- director_pulse — the give-to-get pay & pricing exchange ("Blind for pros")
-- ============================================
-- Directors and pros anonymously share what they earn AND how their program
-- is priced: lesson rates, the split with the club, clinic pricing, stringing.
-- None of that is in a 990. Contributing unlocks the aggregates; nobody ever
-- sees another row. No name, no club name — region/state/band fields only.
--
-- Idempotent / safe to re-run.
-- ============================================

CREATE TABLE IF NOT EXISTS director_pulse (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Who (banded, never identifying)
  role TEXT NOT NULL,              -- 'Director' | 'Head Pro' | 'Staff Pro'
  club_type TEXT NOT NULL,         -- see CLUB_TYPES in src/lib/benchmarks/pulse.ts
  size_band TEXT,                  -- member households band
  state TEXT,                      -- stored for future region math; never returned
  region TEXT,
  years_band TEXT,
  employment TEXT,                 -- 'W-2 salaried' | 'W-2 hourly' | '1099 / independent'

  -- Pay (annual USD)
  base_salary INT,
  bonus INT,
  total_income INT,                -- everything: salary + lessons + clinics + stringing

  -- Pricing & splits
  private_rate INT,                -- member price, 60-min private
  private_share_pct INT,           -- % of the private fee the pro keeps
  clinic_price_hr INT,             -- adult clinic, per player per hour
  clinic_pay_model TEXT,           -- 'percent' | 'hourly' | 'included'
  clinic_pay_value INT,            -- % if percent, $/hr if hourly
  junior_price_hr INT,             -- junior program, per player per hour
  stringing TEXT,                  -- 'pro' | 'club' | 'split' | 'none'
  teaching_hours_wk INT,

  health_insurance BOOLEAN,
  retirement_match BOOLEAN,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_director_pulse_role ON director_pulse(role);

ALTER TABLE director_pulse ENABLE ROW LEVEL SECURITY;

-- Owners read/write only their own row. Aggregates are computed by a
-- service-role API that returns suppressed, rounded statistics only.
DROP POLICY IF EXISTS "Owners manage own pulse row" ON director_pulse;
CREATE POLICY "Owners manage own pulse row" ON director_pulse
  FOR ALL USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());

CREATE OR REPLACE FUNCTION touch_director_pulse_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_director_pulse_updated_at ON director_pulse;
CREATE TRIGGER trg_director_pulse_updated_at
  BEFORE UPDATE ON director_pulse
  FOR EACH ROW EXECUTE FUNCTION touch_director_pulse_updated_at();
