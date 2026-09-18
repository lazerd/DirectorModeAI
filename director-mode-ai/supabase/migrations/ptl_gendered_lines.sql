-- ============================================
-- PTL — men and women on the same team
-- ============================================
--
-- The format: a meeting is four lines — men's singles, women's singles, men's
-- doubles, women's doubles — played at once across four courts. Men never play
-- women. At 2-2, a MIXED DOUBLES decides it, which is the moment the league
-- gets talked about for.
--
-- Two teams meet on 4 courts, two meetings run at once, so a venue needs
-- EIGHT courts. That is the real cost of this format and it shrinks the list of
-- possible hosts; eight teams rather than twelve is the other half of the trade.
--
-- WHY A DECIDER LINE AND NOT A SHOOTOUT. ptl_shootouts holds points played to
-- break a tie (a 7-point tiebreak, a 2-of-3 decider). A mixed doubles is a
-- match: it has a score, a court, four players and a winner, exactly like every
-- other line. Modelling it as a line means the match-night screen, the
-- standings and the recap all already know how to handle it. It is flagged
-- is_decider so it is excluded from the line count that produces the 2-2 in the
-- first place.
--
-- Safe to re-run.
-- ============================================

-- ---------- who is eligible for which line ----------
-- Nullable on purpose: entries already in the database predate this, and an
-- open-category season never asks. The enrolment form requires it when the
-- season's format needs it.
ALTER TABLE ptl_entries
  ADD COLUMN IF NOT EXISTS gender TEXT
    CHECK (gender IS NULL OR gender IN ('m', 'f'));

CREATE INDEX IF NOT EXISTS idx_ptl_entries_gender
  ON ptl_entries(season_id, gender) WHERE gender IS NOT NULL;

-- ---------- what kind of line this is ----------
-- 'singles' and 'doubles' are the original open format and stay the default so
-- existing rows and seasons are untouched.
ALTER TABLE ptl_lines
  ADD COLUMN IF NOT EXISTS line_kind TEXT NOT NULL DEFAULT 'open'
    CHECK (line_kind IN (
      'open',            -- gender not specified (the original 2-line format)
      'mens_singles',
      'womens_singles',
      'mens_doubles',
      'womens_doubles',
      'mixed_doubles'
    ));

-- The mixed doubles that only gets played when the four lines finish level.
ALTER TABLE ptl_lines
  ADD COLUMN IF NOT EXISTS is_decider BOOLEAN NOT NULL DEFAULT FALSE;

/*
 * UNIQUE(meeting_id, line_type) was fine when a meeting had one singles and one
 * doubles. It cannot survive men's AND women's doubles on the same meeting.
 *
 * The replacement keeps line_type in the key alongside line_kind. Dropping it
 * and keying on kind alone looks tidier and fails immediately: every existing
 * line defaults to kind 'open', so a meeting's singles and doubles would
 * collide on ('open', false). With line_type retained, old rows stay distinct
 * and the new gendered kinds sit beside each other cleanly.
 */
ALTER TABLE ptl_lines DROP CONSTRAINT IF EXISTS ptl_lines_meeting_id_line_type_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ptl_lines_meeting_kind
  ON ptl_lines(meeting_id, line_type, line_kind, is_decider);

-- ---------- how a division is played ----------
-- 'open_two'  : 1 singles + 1 doubles, 4 courts for a 4-team night (original)
-- 'gendered_four' : M/W singles + M/W doubles, mixed decider, 8 courts
ALTER TABLE ptl_divisions
  ADD COLUMN IF NOT EXISTS line_format TEXT NOT NULL DEFAULT 'open_two'
    CHECK (line_format IN ('open_two', 'gendered_four'));

/*
 * How a tie is broken, which differs by format and must not be inferred:
 *
 *   'cascade'  — the original five rungs: total games, then a pair of 7-point
 *                tiebreaks, then combined points, then a 2-of-3 decider.
 *   'mixed'    — level on lines sends both teams out for a mixed doubles.
 *
 * Stored per division rather than per season so a section could run one
 * division each way while it works out which it prefers.
 */
ALTER TABLE ptl_divisions
  ADD COLUMN IF NOT EXISTS tiebreak_mode TEXT NOT NULL DEFAULT 'cascade'
    CHECK (tiebreak_mode IN ('cascade', 'mixed'));

-- ---------- roster composition ----------
-- A gendered_four meeting needs 1 woman for singles and 2 for doubles, so three
-- women on court and four on a roster to rotate. Enforced by the draft rather
-- than hoped for, the way a fantasy draft enforces positions.
ALTER TABLE ptl_seasons
  ADD COLUMN IF NOT EXISTS min_men INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ptl_seasons
  ADD COLUMN IF NOT EXISTS min_women INTEGER NOT NULL DEFAULT 0;

-- Courts per division moves with the format: four lines at once across two
-- concurrent meetings is eight.
COMMENT ON COLUMN ptl_seasons.courts_per_division IS
  'Courts a division needs for one night. open_two = 4, gendered_four = 8.';
