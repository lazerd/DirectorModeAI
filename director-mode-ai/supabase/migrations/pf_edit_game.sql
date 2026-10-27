-- CourtConnect: a posted game can be changed, and the club can step in
-- (2026-10-27).
--
-- QA #15: a host who posted Court 3 for Tuesday, or left the court blank
-- because it wasn't decided yet, had no way to change it. The only way out was
-- to cancel (an email to everyone) and repost (another club-wide blast, and a
-- second post against the 3-a-day limit).
--
-- QA #16: when a member calls the office ("take me out", "it's raining, cancel
-- it"), the director could see the game and do nothing about it. During the
-- earlier incident it was fixed by hand in SQL.
--
--   pf_edit_game        the host (or staff) changes day/time, length, court,
--                       note and players needed. Never below the number already
--                       seated; open/full is worked out again from the seats.
--   pf_is_club_staff    owner, director, coach or front desk at the club. The
--                       same roles resolveActiveClub lets into "Run the club".
--   pf_staff_remove     staff take a player off: the same move as the host's
--   pf_staff_cancel_game  Remove and Cancel, by delegating to pf_host_remove and
--                       pf_cancel_game as the poster. One copy of the seat and
--                       status rules, so the two can never drift.
--
-- All service_role only. The API decides who is asking (the host's token, or a
-- signed-in staff account); these functions check it again under the row lock.
-- Platform-operator access (another club, reached only as the platform) is not
-- staff here and gets 'not_staff'.

create or replace function public.pf_is_club_staff(p_club uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  SELECT p_club IS NOT NULL AND p_user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM cc_clubs c WHERE c.id = p_club AND c.owner_id = p_user)
    OR EXISTS (
      SELECT 1 FROM cc_club_members m
       WHERE m.club_id = p_club
         AND m.user_id = p_user
         AND m.role IN ('owner', 'director', 'coach', 'front_desk')
    )
  );
$function$;

revoke all on function public.pf_is_club_staff(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pf_is_club_staff(uuid, uuid) to service_role;

create or replace function public.pf_edit_game(
  p_game uuid,
  p_actor uuid,
  p_starts_at timestamptz,
  p_duration integer,
  p_court text,
  p_note text,
  p_spots integer,
  p_staff_user uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  g pf_games%ROWTYPE;
  taken integer;
  waiting integer;
  new_court text := left(nullif(btrim(coalesce(p_court, '')), ''), 60);
  new_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
  new_status text;
BEGIN
  SELECT * INTO g FROM pf_games WHERE id = p_game FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  -- The host, or the club's own staff. Nobody else, ever.
  IF p_staff_user IS NOT NULL THEN
    IF NOT pf_is_club_staff(g.club_id, p_staff_user) THEN
      RETURN jsonb_build_object('result', 'not_staff');
    END IF;
  ELSIF p_actor IS NULL OR pf_poster_person(p_game) IS DISTINCT FROM p_actor THEN
    RETURN jsonb_build_object('result', 'not_poster');
  END IF;

  IF g.status = 'cancelled' THEN
    RETURN jsonb_build_object('result', 'cancelled');
  END IF;
  IF g.status = 'expired' OR g.starts_at <= now() THEN
    RETURN jsonb_build_object('result', 'past');
  END IF;

  -- The same limits as posting (pf_post_game and the table's checks).
  IF p_starts_at IS NULL OR p_starts_at <= now() THEN
    RETURN jsonb_build_object('result', 'in_past');
  END IF;
  IF p_starts_at > now() + interval '60 days' THEN
    RETURN jsonb_build_object('result', 'too_far');
  END IF;
  IF p_duration IS NULL OR p_duration < 30 OR p_duration > 240 THEN
    RETURN jsonb_build_object('result', 'bad_duration');
  END IF;
  IF p_spots IS NULL OR p_spots < 1 OR p_spots > 3 OR (g.format = 'singles' AND p_spots > 1) THEN
    RETURN jsonb_build_object('result', 'bad_spots');
  END IF;

  -- Never fewer spots than people already on the court. Take someone off first.
  SELECT count(*) INTO taken FROM pf_game_players WHERE game_id = p_game AND status = 'in';
  IF p_spots < taken THEN
    RETURN jsonb_build_object('result', 'below_seated', 'seated', taken);
  END IF;

  new_status := CASE WHEN taken >= p_spots THEN 'full' ELSE 'open' END;

  UPDATE pf_games
     SET starts_at = p_starts_at,
         duration_min = p_duration,
         court = new_court,
         note = new_note,
         spots_needed = p_spots,
         status = new_status,
         filled_at = CASE
           WHEN new_status = 'full' THEN CASE WHEN g.status = 'full' THEN g.filled_at ELSE now() END
           ELSE NULL
         END,
         -- A new day needs its own morning-of reminder, and a game that
         -- reopens starts over, as in pf_host_remove.
         reminder_sent_at = CASE
           WHEN p_starts_at IS DISTINCT FROM g.starts_at OR new_status IS DISTINCT FROM g.status THEN NULL
           ELSE g.reminder_sent_at
         END,
         updated_at = now()
   WHERE id = p_game;

  SELECT count(*) INTO waiting FROM pf_game_players WHERE game_id = p_game AND status = 'wait';

  RETURN jsonb_build_object(
    'result', 'edited',
    'seated', taken,
    'waiting', waiting,
    'became_full', g.status = 'open' AND new_status = 'full',
    'reopened', g.status = 'full' AND new_status = 'open',
    -- The game as it was, so the "game changed" email can say old -> new.
    'old', jsonb_build_object(
      'starts_at', g.starts_at,
      'duration_min', g.duration_min,
      'court', g.court,
      'note', g.note,
      'spots_needed', g.spots_needed
    )
  );
END;
$function$;

revoke all on function public.pf_edit_game(uuid, uuid, timestamptz, integer, text, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.pf_edit_game(uuid, uuid, timestamptz, integer, text, text, integer, uuid) to service_role;

/*
 * Staff take a player off. pf_host_remove does the work AS THE POSTER, so a
 * seat comes off the same way whoever asks: the seat goes to 'out', an invited
 * friend's link to 'left', and a full game reopens.
 */
create or replace function public.pf_staff_remove(
  p_game uuid,
  p_staff_user uuid,
  p_seat uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  club uuid;
BEGIN
  SELECT club_id INTO club FROM pf_games WHERE id = p_game;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;
  IF NOT pf_is_club_staff(club, p_staff_user) THEN
    RETURN jsonb_build_object('result', 'not_staff');
  END IF;
  RETURN pf_host_remove(p_game, pf_poster_person(p_game), p_seat);
END;
$function$;

revoke all on function public.pf_staff_remove(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.pf_staff_remove(uuid, uuid, uuid) to service_role;

/* Staff call a game off ("it's raining"). Same rules as the host's Cancel. */
create or replace function public.pf_staff_cancel_game(
  p_game uuid,
  p_staff_user uuid
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  club uuid;
BEGIN
  SELECT club_id INTO club FROM pf_games WHERE id = p_game;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;
  IF NOT pf_is_club_staff(club, p_staff_user) THEN
    RETURN jsonb_build_object('result', 'not_staff');
  END IF;
  RETURN pf_cancel_game(p_game, pf_poster_person(p_game));
END;
$function$;

revoke all on function public.pf_staff_cancel_game(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pf_staff_cancel_game(uuid, uuid) to service_role;
