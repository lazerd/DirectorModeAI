-- =====================================================================
-- A claimed sub seat must not keep the dropout's decline stamp.
--
-- /api/captain/claim used to write the sub into the seat without clearing
-- player{N}_declined_at / player{N}_decline_note, so the captain page read the
-- SUB as the one who pulled out ("Chris pulled out of this lineup"). The route
-- now clears both and marks the seat confirmed by the player; this backfills
-- seats claimed before the fix.
--
-- Only touches a seat still held by the claimer whose decline stamp predates
-- the claim — a sub who claimed and then pulled out himself keeps his own.
--
-- Run: node scripts/dbrun.mjs supabase/migrations/captain_sub_claim_clears_decline.sql
-- Safe to re-run.
-- =====================================================================

UPDATE captain_lineups l
SET player1_declined_at = NULL,
    player1_decline_note = NULL,
    player1_confirmed_source = COALESCE(l.player1_confirmed_source, 'player'),
    updated_at = now()
FROM captain_sub_requests r
WHERE r.lineup_id = l.id
  AND r.status = 'filled'
  AND r.slot = 1
  AND l.player1_id = r.claimed_by_player_id
  AND l.player1_declined_at IS NOT NULL
  AND l.player1_declined_at <= r.claimed_at;

UPDATE captain_lineups l
SET player2_declined_at = NULL,
    player2_decline_note = NULL,
    player2_confirmed_source = COALESCE(l.player2_confirmed_source, 'player'),
    updated_at = now()
FROM captain_sub_requests r
WHERE r.lineup_id = l.id
  AND r.status = 'filled'
  AND r.slot = 2
  AND l.player2_id = r.claimed_by_player_id
  AND l.player2_declined_at IS NOT NULL
  AND l.player2_declined_at <= r.claimed_at;
