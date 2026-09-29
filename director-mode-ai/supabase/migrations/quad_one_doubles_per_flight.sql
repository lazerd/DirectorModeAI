-- One round-4 doubles per quad flight. Two parents submitting the last two
-- round-3 scores at the same moment could each see "all six singles done, no
-- doubles yet" and both insert one. lib/quadDoubles treats the 23505 from the
-- loser of that race as "already created".
create unique index if not exists quad_matches_one_doubles_per_flight
  on public.quad_matches (flight_id)
  where match_type = 'doubles';
