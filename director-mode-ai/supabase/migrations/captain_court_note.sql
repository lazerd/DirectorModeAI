-- The pre-season intake asks an open question about courts ("happy anywhere",
-- "not court 1"), but captain_players.court_limit is a constrained enum the
-- lineup generator reads (singles_only | doubles_only | no_court_1). Writing
-- free text into it failed the check constraint and showed players a raw
-- Postgres error on submit. Free text now has its own column; court_limit stays
-- structured so lineup generation keeps working.
alter table captain_players add column if not exists court_note text;
