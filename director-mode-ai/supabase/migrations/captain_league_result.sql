-- The result as the LEAGUE reports it: "Won 2-1", "Lost 0-3".
--
-- A captain's own scorecard (captain_results, per court) is richer and always
-- wins when it exists. But a team loaded from a league site arrives with the
-- team result and nothing else — NorCal publishes "Won 2-1" and no line scores
-- — and a played match that shows no result at all reads as a broken app
-- (Artem Melnik, 2026-09-19: "could see results of already played matches").
alter table captain_matches add column if not exists league_result text;
