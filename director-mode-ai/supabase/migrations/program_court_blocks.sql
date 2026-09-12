-- ============================================
-- A class holds its courts.
-- ============================================
-- Closes a real hole opened by online court booking: a class lived in
-- club_programs and nowhere else, so nothing stopped a member booking court 1
-- at 3:30 on Tuesday on top of the after-school juniors. The class was real to
-- the club and invisible to the court sheet.
--
-- Fixed by giving a program the option to MATERIALIZE its meetings as
-- reservations — the same table every other claim on court time lives in, and
-- the one the no_double_booking EXCLUDE constraint protects. Once blocked, a
-- class cannot be booked over by anyone, through any path, including a buggy
-- one.
--
-- Two changes:
--   1. `programs` joins the reservations.source vocabulary, so a blocked class
--      is attributable and removable as a set.
--   2. club_programs learns how many courts it needs and whether to block.
--
-- Safe to re-run.
-- ============================================

-- --------------------------------------------
-- reservations.source gains 'programs'
-- --------------------------------------------
-- source says which subsystem created the row, and source_id points into that
-- subsystem's table. A blocked class is source='programs', source_id=the
-- club_programs id — which is what makes "unblock this class" a targeted
-- delete rather than a guess.
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_source_check;
ALTER TABLE reservations ADD CONSTRAINT reservations_source_check
  CHECK (source = ANY (ARRAY[
    'manual', 'ai', 'lessons', 'mixer', 'courtconnect',
    'tournaments', 'quads', 'jtt', 'import', 'calendar', 'programs'
  ]));

CREATE INDEX IF NOT EXISTS idx_reservations_source_id
  ON reservations(source, source_id)
  WHERE source_id IS NOT NULL;

-- --------------------------------------------
-- club_programs: how much court it needs
-- --------------------------------------------
ALTER TABLE club_programs
  -- How many courts the class occupies. Null means the club has not said, and
  -- blocking is refused rather than guessing 1 and under-booking the class.
  ADD COLUMN IF NOT EXISTS court_count INT,
  -- Whether its meetings are held on the court sheet. Off by default: a club
  -- must be able to publish and sell a class before it has decided which
  -- courts it runs on, and a partner's swim program has no court at all.
  ADD COLUMN IF NOT EXISTS blocks_courts BOOLEAN NOT NULL DEFAULT FALSE,
  -- When the blocks were last rebuilt, so the editor can say whether the court
  -- sheet is in step with the dates.
  ADD COLUMN IF NOT EXISTS courts_blocked_at TIMESTAMPTZ;

ALTER TABLE club_programs DROP CONSTRAINT IF EXISTS club_programs_court_count_check;
ALTER TABLE club_programs ADD CONSTRAINT club_programs_court_count_check
  CHECK (court_count IS NULL OR (court_count > 0 AND court_count <= 40));

COMMENT ON COLUMN club_programs.blocks_courts IS
  'Whether this class materializes its meetings into reservations. Off by '
  'default — a class can be sold before its courts are decided, and a '
  'partner program may use no courts at all.';
COMMENT ON COLUMN club_programs.courts_blocked_at IS
  'Last time the blocks were rebuilt. Compared against updated_at to tell a '
  'director the court sheet is behind the dates.';
