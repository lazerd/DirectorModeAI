-- CourtConnect: a member the host took off knows it (2026-10-27).
--
-- Re-test of #17: a removed invited friend's page said "The organizer took you
-- off", but a removed MEMBER was just 'out', the same as someone who left on
-- their own, so their link offered "Yes, I'm in" again. The seat now records
-- that the host (or the club, via pf_staff_remove) removed it. Seating them
-- again on purpose -- host add, or their own answer once it is allowed --
-- clears the mark.

alter table pf_game_players add column if not exists removed_by_host boolean not null default false;

comment on column pf_game_players.removed_by_host is
  'The host or the club took this seat off the game. Their own link stops offering a way back in.';

create or replace function public.pf_seat_clear_removed()
returns trigger
language plpgsql
set search_path to 'public'
as $f$
BEGIN
  IF NEW.status IN ('in', 'wait') AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.removed_by_host := false;
  END IF;
  RETURN NEW;
END;
$f$;

drop trigger if exists pf_seat_clear_removed on pf_game_players;
create trigger pf_seat_clear_removed before update on pf_game_players
  for each row execute function public.pf_seat_clear_removed();

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

  UPDATE pf_game_players SET status = 'out', left_at = now(), removed_by_host = true WHERE id = s.id;
  -- An invited friend's own link reads "the organizer took you off", and
  -- cannot be tapped back in. 'left' is for a friend who dropped out themselves.
  UPDATE pf_guest_links SET status = 'removed', answered_at = now() WHERE seat_id = s.id AND status = 'in';

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
