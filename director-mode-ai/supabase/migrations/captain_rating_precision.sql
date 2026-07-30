-- =====================================================================
-- CaptainMode — let ratings hold a dynamic rating, not just an NTRP level
--
-- captain_players.rating was numeric(3,1), sized for NTRP levels (3.0, 3.5).
-- That silently rounds anything finer: importing a TennisRecord dynamic
-- rating of 3.236 stored 3.2, and 3.236 vs 3.198 — two players a captain
-- wants to tell apart — both collapsed to 3.2.
--
-- That matters because most of a B2/B3 roster self-rates a flat 3.0, so the
-- level carries no ordering information at all; the decimals are the entire
-- point of importing them.
--
-- Widening only. 3.5 becomes 3.500, no existing value changes.
-- Idempotent: re-running is a no-op once the type already matches.
-- =====================================================================

do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_name = 'captain_players'
       and column_name = 'rating'
       and numeric_scale < 3
  ) then
    alter table captain_players
      alter column rating type numeric(6,3);
  end if;
end $$;

comment on column captain_players.rating is
  'NTRP level (3.0, 3.5) or a finer dynamic rating (3.236) imported from a rating service. Three decimals so players who share an NTRP level can still be ordered.';

-- =====================================================================
-- VERIFY:
--   select numeric_precision, numeric_scale from information_schema.columns
--    where table_name='captain_players' and column_name='rating';
--   -- expect 6, 3
-- =====================================================================
