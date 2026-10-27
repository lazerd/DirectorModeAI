-- CaptainMode: results that have already moved the strength order are spent
-- (2026-10-27).
--
-- Darrin applied all 21 suggested moves on Fall B2/B3 and the panel came
-- straight back with a new set. The suggestion judged every result of the
-- season against TODAY's order, so once the order changed the same wins and
-- losses argued for a fresh round of moves, forever. A match whose results
-- have been applied is now recorded here and leaves the suggestion; only
-- matches played after it can move anyone again.

alter table captain_teams
  add column if not exists form_applied_match_ids uuid[] not null default '{}';

comment on column captain_teams.form_applied_match_ids is
  'Played matches whose results the captain has already applied to the strength order. The form suggestion ignores them.';
