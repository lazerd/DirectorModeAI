-- ============================================
-- CalendarMode — more kinds of calendar
-- ============================================
-- The first cut assumed the thing you upload is a school calendar. Directors
-- have a stack of them: the swim team's meet schedule, the USTA league grid,
-- the golf and dining calendar, and the facility's own closure list. Each has
-- its own vocabulary and its own meaning for the planner, so provenance needs
-- to record which one a constraint came from.
--
-- Adds 'swim' and 'facility' to calendar_constraints.source.
-- Safe to re-run.
-- ============================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calendar_constraints_source_check') THEN
    ALTER TABLE calendar_constraints DROP CONSTRAINT calendar_constraints_source_check;
  END IF;

  ALTER TABLE calendar_constraints ADD CONSTRAINT calendar_constraints_source_check
    CHECK (source IN (
      'school',    -- district / school calendar
      'swim',      -- swim team meets, time trials, championships
      'usta',      -- USTA / JTT / interclub league play
      'club',      -- the club's own events: golf, dining, socials
      'facility',  -- closures, resurfacing, maintenance, private rentals
      'holiday',
      'clubmode',  -- swept from ClubMode itself
      'manual'
    ));
END $$;
