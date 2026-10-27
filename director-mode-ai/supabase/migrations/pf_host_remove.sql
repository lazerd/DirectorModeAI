-- CourtConnect: the host can take someone OFF their game, and nudge the people
-- who never answered (2026-10-27).
--
-- Walden again. He seated Tony Chen by hand (pf_host_add), Tony cancelled, and
-- there was no way back: the host could put a player in but not take one out,
-- and a seat the host typed in has no link of its own to leave from. Darrin had
-- to do it in SQL. Same morning he asked to "send a repeat invitation to the
-- non responders letting people know I need someone".
--
-- pf_host_remove mirrors pf_leave_spot / pf_guest_answer('leave'): the seat goes
-- to 'out', a friend's link goes to 'left', and a full game reopens. It works by
-- SEAT id (pf_game_players.id) because a guest seat has no person to name.

alter table pf_games add column if not exists nudged_at timestamptz;

comment on column pf_games.nudged_at is
  'When the host re-sent the invitation to everyone who never answered. One nudge per game.';

create or replace function public.pf_host_remove(
  p_game uuid,
  p_actor uuid,
  p_seat uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  g pf_games%ROWTYPE;
  s pf_game_players%ROWTYPE;
  was_full boolean;
  waiting integer;
  seat_name text;
BEGIN
  SELECT * INTO g FROM pf_games WHERE id = p_game FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  -- Only the person who posted it. Same rule as seating and cancelling.
  IF pf_poster_person(p_game) IS DISTINCT FROM p_actor THEN
    RETURN jsonb_build_object('result', 'not_poster');
  END IF;
  IF g.status = 'cancelled' THEN
    RETURN jsonb_build_object('result', 'cancelled');
  END IF;
  IF g.starts_at <= now() THEN
    RETURN jsonb_build_object('result', 'past');
  END IF;

  SELECT * INTO s FROM pf_game_players WHERE id = p_seat AND game_id = p_game AND status = 'in';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_in');
  END IF;

  UPDATE pf_game_players SET status = 'out', left_at = now() WHERE id = s.id;
  -- An invited friend's own link should read "you're not in", not "you're in".
  UPDATE pf_guest_links SET status = 'left', answered_at = now() WHERE seat_id = s.id AND status = 'in';

  seat_name := coalesce(
    s.guest_name,
    (SELECT v.full_name FROM cc_vault_players v WHERE v.id = s.person_id)
  );

  was_full := g.status = 'full';
  IF was_full THEN
    UPDATE pf_games SET status = 'open', filled_at = NULL, reminder_sent_at = NULL, updated_at = now()
     WHERE id = p_game;
  END IF;

  SELECT count(*) INTO waiting FROM pf_game_players WHERE game_id = p_game AND status = 'wait';

  RETURN jsonb_build_object(
    'result', 'removed',
    'reopened', was_full,
    'waiting', waiting,
    'person_id', s.person_id,
    'name', seat_name
  );
END;
$function$;

revoke all on function public.pf_host_remove(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.pf_host_remove(uuid, uuid, uuid) to service_role;
