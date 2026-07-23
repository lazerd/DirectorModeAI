-- ============================================
-- CalendarMode — the year-planning layer
-- ============================================
-- Every other ClubMode tool operates INSIDE an event. CalendarMode sits
-- above them: it answers "what's our event calendar for next year?"
--
-- The critical distinction from `events`:
--   events          = the EXECUTION row. Run-day. Has courts, rounds, matches.
--   calendar_items  = an INTENTION. "We want a Calcutta in October."
--
-- An item is promoted into a real `events` row when the director is ready
-- (calendar_items.event_id links the two). Keeping them separate is what
-- stops a year of half-configured drafts from polluting `events` and the
-- three-mode classifier in src/lib/eventCategory.ts.
--
-- Tables:
--   calendar_plans        — one year plan per club
--   calendar_items        — a planned event within a plan
--   calendar_constraints  — anything that blocks or shades a date
--   calendar_imports      — upload provenance, so an import is reversible
--
-- RLS uses the existing SECURITY DEFINER helpers from ws1_membership_stepA:
--   is_club_member(club) — any member of the club (read)
--   is_club_staff(club)  — owner|director only (write)
--
-- Safe to re-run.
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- --------------------------------------------
-- 1. calendar_plans — one year of intent
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_plans (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id     UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  year        INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','approved','published','archived')),

  -- When the club can realistically host outdoors, e.g.
  -- [{"label":"Outdoor season","start":"04-01","end":"10-31"}]
  season_windows JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Planning targets the scoring engine paces against, e.g.
  -- {"events_per_month":2,"revenue_target_cents":4000000,
  --  "department_mix":{"tennis":0.6,"social":0.2,"swim":0.2}}
  goals       JSONB NOT NULL DEFAULT '{}'::jsonb,

  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_plans_club ON calendar_plans(club_id, year);

-- A club shows exactly one published calendar per year to its members.
-- Drafts are unlimited so a director can explore alternatives.
CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_plans_one_published
  ON calendar_plans(club_id, year) WHERE status = 'published';

-- --------------------------------------------
-- 2. calendar_items — a planned event
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id     UUID NOT NULL REFERENCES calendar_plans(id) ON DELETE CASCADE,
  -- Denormalized from the plan so RLS and club-scoped queries don't need a join.
  club_id     UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,

  title       TEXT NOT NULL,
  -- Key into src/lib/calendar/catalog.ts. NULL = custom or AI-invented,
  -- which is a first-class case: the catalog seeds, it doesn't constrain.
  catalog_key TEXT,
  description TEXT,

  -- The department that RUNS it. Who it's FOR lives in `audience`, so a
  -- junior tennis camp is department 'tennis' + audience '{junior}' rather
  -- than forcing an overlap between the two axes.
  department  TEXT NOT NULL DEFAULT 'tennis'
                CHECK (department IN ('tennis','pickleball','swim','fitness','social','other')),
  audience    TEXT[] NOT NULL DEFAULT '{}',

  -- Hint for promotion — validated against TOURNAMENT_FORMATS / MIXER_FORMATS
  -- in src/lib/eventCategory.ts at promote time, not here (the app owns that
  -- taxonomy and it changes more often than this schema should).
  format_hint TEXT,

  status      TEXT NOT NULL DEFAULT 'idea'
                CHECK (status IN ('idea','scheduled','promoted','done','dropped')),

  -- Placement. NULL target_date = an idea that hasn't been placed yet.
  target_date      DATE,
  target_end_date  DATE,
  start_time       TIME,
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes > 0),

  -- How this event wants to be placed. Resolved by src/lib/calendar/anchors.ts:
  --   fixed:07-04             — must be July 4
  --   nearest:07-04:SAT       — the Saturday nearest July 4
  --   nth:3:6:SAT             — 3rd Saturday of June
  --   grand-slam:wimbledon    — tracks the Slam window
  --   NULL                    — floating; the engine picks freely
  anchor_rule TEXT,

  courts_needed  INTEGER CHECK (courts_needed IS NULL OR courts_needed >= 0),
  staff_needed   INTEGER CHECK (staff_needed IS NULL OR staff_needed >= 0),

  expected_attendance   INTEGER CHECK (expected_attendance IS NULL OR expected_attendance >= 0),
  entry_fee_cents       INTEGER CHECK (entry_fee_cents IS NULL OR entry_fee_cents >= 0),
  expected_revenue_cents INTEGER,
  expected_cost_cents    INTEGER,

  -- AI-generated, regenerable, never load-bearing.
  run_of_show JSONB NOT NULL DEFAULT '{}'::jsonb,
  marketing   JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Why the engine put it here. score_breakdown holds the itemized reasons[]
  -- so the UI can always answer "why this weekend?" without recomputing.
  score           NUMERIC,
  score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Set once promoted into a real event.
  event_id       UUID REFERENCES events(id) ON DELETE SET NULL,
  -- The tentative CourtSheet hold covering this item's courts.
  hold_series_id UUID,

  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (target_end_date IS NULL OR target_date IS NULL OR target_end_date >= target_date)
);

CREATE INDEX IF NOT EXISTS idx_calendar_items_plan ON calendar_items(plan_id);
CREATE INDEX IF NOT EXISTS idx_calendar_items_club_date ON calendar_items(club_id, target_date);
CREATE INDEX IF NOT EXISTS idx_calendar_items_event ON calendar_items(event_id) WHERE event_id IS NOT NULL;

-- --------------------------------------------
-- 3. calendar_constraints — the world the plan lives in
-- --------------------------------------------
-- Impact is SIGNED on purpose. Spring break is not simply "bad": it's
-- favorable for family events and heavy for junior programs. A single
-- boolean blackout flag can't express that, and the difference is most of
-- what makes a recommendation feel informed rather than mechanical.
CREATE TABLE IF NOT EXISTS calendar_constraints (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id     UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  -- NULL = applies to every plan for this club (school calendars, holidays).
  -- Set = scoped to one plan (a one-off "board asked us to skip this weekend").
  plan_id     UUID REFERENCES calendar_plans(id) ON DELETE CASCADE,
  import_id   UUID,

  source      TEXT NOT NULL DEFAULT 'manual'
                CHECK (source IN ('school','club','holiday','usta','clubmode','manual')),
  title       TEXT NOT NULL,
  starts_on   DATE NOT NULL,
  ends_on     DATE NOT NULL,

  impact      TEXT NOT NULL DEFAULT 'heavy'
                CHECK (impact IN ('blocking','heavy','light','favorable')),
  -- Which audiences this drains (or favors). Empty = applies to everyone.
  audience_tags TEXT[] NOT NULL DEFAULT '{}',

  meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS idx_calendar_constraints_club ON calendar_constraints(club_id, starts_on, ends_on);
CREATE INDEX IF NOT EXISTS idx_calendar_constraints_import ON calendar_constraints(import_id) WHERE import_id IS NOT NULL;

-- --------------------------------------------
-- 4. calendar_imports — provenance
-- --------------------------------------------
-- Every constraint that came from a file remembers which upload produced it,
-- so a misread school-calendar PDF can be undone as one unit instead of
-- leaving the director to hunt down forty bad rows by hand.
CREATE TABLE IF NOT EXISTS calendar_imports (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id     UUID NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  plan_id     UUID REFERENCES calendar_plans(id) ON DELETE SET NULL,

  kind        TEXT NOT NULL
                CHECK (kind IN ('ics','pdf','image','csv','text','clubmode')),
  filename    TEXT,
  label       TEXT,
  item_count  INTEGER NOT NULL DEFAULT 0,
  summary     TEXT,
  meta        JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_by  UUID NOT NULL REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calendar_imports_club ON calendar_imports(club_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_constraints_import_fk') THEN
    ALTER TABLE calendar_constraints
      ADD CONSTRAINT calendar_constraints_import_fk
      FOREIGN KEY (import_id) REFERENCES calendar_imports(id) ON DELETE CASCADE;
  END IF;
END $$;

-- --------------------------------------------
-- 5. updated_at triggers
-- --------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_calendar_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_calendar_plans_touch ON calendar_plans;
CREATE TRIGGER trg_calendar_plans_touch BEFORE UPDATE ON calendar_plans
  FOR EACH ROW EXECUTE FUNCTION public.touch_calendar_updated_at();

DROP TRIGGER IF EXISTS trg_calendar_items_touch ON calendar_items;
CREATE TRIGGER trg_calendar_items_touch BEFORE UPDATE ON calendar_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_calendar_updated_at();

-- --------------------------------------------
-- 6. RLS
-- --------------------------------------------
-- Staff (owner|director) write; any club member reads their club's plans.
-- Published plans are additionally readable by anyone, which is what powers
-- the member-facing /calendar/[clubSlug] page. Note that cost and revenue
-- columns live on calendar_items and ARE covered by that public policy —
-- the public route must select an explicit column list, never `*`.
-- See src/app/api/calendar/public/[clubSlug]/route.ts.
ALTER TABLE calendar_plans       ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_constraints ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_imports     ENABLE ROW LEVEL SECURITY;

-- plans
DROP POLICY IF EXISTS calendar_plans_read ON calendar_plans;
CREATE POLICY calendar_plans_read ON calendar_plans FOR SELECT
  USING (is_club_member(club_id) OR status = 'published');

DROP POLICY IF EXISTS calendar_plans_write ON calendar_plans;
CREATE POLICY calendar_plans_write ON calendar_plans FOR ALL
  USING (is_club_staff(club_id)) WITH CHECK (is_club_staff(club_id));

-- items
DROP POLICY IF EXISTS calendar_items_read ON calendar_items;
CREATE POLICY calendar_items_read ON calendar_items FOR SELECT
  USING (
    is_club_member(club_id)
    OR EXISTS (
      SELECT 1 FROM calendar_plans p
      WHERE p.id = calendar_items.plan_id AND p.status = 'published'
    )
  );

DROP POLICY IF EXISTS calendar_items_write ON calendar_items;
CREATE POLICY calendar_items_write ON calendar_items FOR ALL
  USING (is_club_staff(club_id)) WITH CHECK (is_club_staff(club_id));

-- constraints — internal planning data, never public
DROP POLICY IF EXISTS calendar_constraints_read ON calendar_constraints;
CREATE POLICY calendar_constraints_read ON calendar_constraints FOR SELECT
  USING (is_club_member(club_id));

DROP POLICY IF EXISTS calendar_constraints_write ON calendar_constraints;
CREATE POLICY calendar_constraints_write ON calendar_constraints FOR ALL
  USING (is_club_staff(club_id)) WITH CHECK (is_club_staff(club_id));

-- imports — staff only, both directions
DROP POLICY IF EXISTS calendar_imports_all ON calendar_imports;
CREATE POLICY calendar_imports_all ON calendar_imports FOR ALL
  USING (is_club_staff(club_id)) WITH CHECK (is_club_staff(club_id));

-- --------------------------------------------
-- 7. Let CourtSheet accept holds created by CalendarMode
-- --------------------------------------------
-- Scheduling an item writes a TENTATIVE reservation so the courts are
-- visibly spoken for and the EXCLUDE-USING-gist constraint from
-- courtsheet_005 prevents anything else from taking them.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservations_source_check') THEN
    ALTER TABLE reservations DROP CONSTRAINT reservations_source_check;
  END IF;
  ALTER TABLE reservations ADD CONSTRAINT reservations_source_check
    CHECK (source IN ('manual','ai','lessons','mixer','courtconnect','tournaments','quads','jtt','import','calendar'));
END $$;
