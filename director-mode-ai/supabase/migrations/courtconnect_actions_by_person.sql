-- Joining, leaving, declining and cancelling happen to a PERSON.
--
-- The companion to courtconnect_reads_people.sql. Those four functions took an
-- account and checked cc_club_members, so someone the club has on its roster
-- but who has never signed in was told "Only members of this club can join its
-- games" -- while holding an invitation the club had just emailed them.
--
-- Membership is now "on this club's PlayerVault", which is the same question
-- the roster answers, and the seat is keyed to the person.
--
-- posted_by stays an ACCOUNT: a game is always posted by somebody signed in.
-- Where these need to compare a person to the poster, they resolve the poster
-- to their roster row first.
--
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.pf_poster_person(p_game uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT v.id FROM pf_games g
    JOIN cc_vault_players v ON v.club_id = g.club_id AND v.user_id = g.posted_by
   WHERE g.id = p_game
   LIMIT 1;
$function$;

/** Is this person on the club's roster? The one membership test CourtConnect uses. */
CREATE OR REPLACE FUNCTION public.pf_is_person_of_club(p_club uuid, p_person uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM cc_vault_players v
     LEFT JOIN cc_club_members m ON m.club_id = v.club_id AND m.user_id = v.user_id
     WHERE v.id = p_person
       AND v.club_id = p_club
       AND coalesce(m.role, 'member') <> 'maintenance'
       AND coalesce(v.membership_status, 'active') <> 'inactive'
  );
$function$;

DROP FUNCTION IF EXISTS public.pf_claim_spot(uuid, uuid, text);
CREATE FUNCTION public.pf_claim_spot(p_game uuid, p_person uuid, p_via text DEFAULT 'board'::text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  g pf_games%ROWTYPE;
  taken integer;
  waiting integer;
BEGIN
  SELECT * INTO g FROM pf_games WHERE id = p_game FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  IF pf_poster_person(p_game) = p_person THEN
    RETURN jsonb_build_object('result', 'own_game');
  END IF;

  IF NOT pf_is_person_of_club(g.club_id, p_person) THEN
    RETURN jsonb_build_object('result', 'not_member');
  END IF;

  SELECT count(*) INTO taken FROM pf_game_players WHERE game_id = p_game AND status = 'in';

  IF EXISTS (SELECT 1 FROM pf_game_players WHERE game_id = p_game AND person_id = p_person AND status = 'in') THEN
    RETURN jsonb_build_object('result', 'already_in', 'spots_left', greatest(g.spots_needed - taken, 0));
  END IF;

  IF g.status = 'cancelled' THEN
    RETURN jsonb_build_object('result', 'cancelled');
  END IF;
  IF g.status = 'expired' OR g.starts_at <= now() THEN
    RETURN jsonb_build_object('result', 'past');
  END IF;

  IF g.status = 'full' OR taken >= g.spots_needed THEN
    IF EXISTS (SELECT 1 FROM pf_game_players WHERE game_id = p_game AND person_id = p_person AND status = 'wait') THEN
      SELECT count(*) INTO waiting
        FROM pf_game_players w
       WHERE w.game_id = p_game AND w.status = 'wait'
         AND w.joined_at <= (SELECT joined_at FROM pf_game_players
                              WHERE game_id = p_game AND person_id = p_person);
      RETURN jsonb_build_object('result', 'already_waiting', 'position', waiting);
    END IF;

    INSERT INTO pf_game_players (game_id, club_id, person_id, user_id, status, via, joined_at, left_at)
    VALUES (p_game, g.club_id, p_person,
            (SELECT v.user_id FROM cc_vault_players v WHERE v.id = p_person),
            'wait', CASE WHEN p_via = 'email' THEN 'email' ELSE 'board' END, now(), NULL)
    ON CONFLICT (game_id, person_id)
    DO UPDATE SET status = 'wait', via = EXCLUDED.via, joined_at = now(), left_at = NULL;

    SELECT count(*) INTO waiting FROM pf_game_players WHERE game_id = p_game AND status = 'wait';
    RETURN jsonb_build_object('result', 'waitlisted', 'position', waiting);
  END IF;

  INSERT INTO pf_game_players (game_id, club_id, person_id, user_id, status, via)
  VALUES (p_game, g.club_id, p_person,
          (SELECT v.user_id FROM cc_vault_players v WHERE v.id = p_person),
          'in', CASE WHEN p_via = 'email' THEN 'email' ELSE 'board' END)
  ON CONFLICT (game_id, person_id)
  DO UPDATE SET status = 'in', via = EXCLUDED.via, joined_at = now(), left_at = NULL;

  taken := taken + 1;
  IF taken >= g.spots_needed THEN
    UPDATE pf_games SET status = 'full', filled_at = now(), updated_at = now() WHERE id = p_game;
  END IF;

  RETURN jsonb_build_object(
    'result', 'joined',
    'spots_left', g.spots_needed - taken,
    'now_full', taken >= g.spots_needed
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.pf_leave_spot(uuid, uuid);
CREATE FUNCTION public.pf_leave_spot(p_game uuid, p_person uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  g pf_games%ROWTYPE;
  was_full boolean;
  waiting integer;
BEGIN
  SELECT * INTO g FROM pf_games WHERE id = p_game FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pf_game_players WHERE game_id = p_game AND person_id = p_person AND status = 'in') THEN
    -- Someone who is only WAITING can step off the list, and that is not a
    -- spot opening: nothing reopens and nobody is told.
    IF EXISTS (SELECT 1 FROM pf_game_players WHERE game_id = p_game AND person_id = p_person AND status = 'wait') THEN
      UPDATE pf_game_players SET status = 'out', left_at = now()
       WHERE game_id = p_game AND person_id = p_person;
      RETURN jsonb_build_object('result', 'off_waitlist');
    END IF;
    RETURN jsonb_build_object('result', 'not_in');
  END IF;
  IF g.status = 'cancelled' THEN
    RETURN jsonb_build_object('result', 'cancelled');
  END IF;
  IF g.starts_at <= now() THEN
    RETURN jsonb_build_object('result', 'past');
  END IF;

  UPDATE pf_game_players SET status = 'out', left_at = now() WHERE game_id = p_game AND person_id = p_person;

  was_full := g.status = 'full';
  IF was_full THEN
    UPDATE pf_games SET status = 'open', filled_at = NULL, reminder_sent_at = NULL, updated_at = now()
     WHERE id = p_game;
  END IF;

  SELECT count(*) INTO waiting FROM pf_game_players WHERE game_id = p_game AND status = 'wait';

  RETURN jsonb_build_object('result', 'left', 'reopened', was_full, 'waiting', waiting);
END;
$function$;

DROP FUNCTION IF EXISTS public.pf_decline_spot(uuid, uuid);
CREATE FUNCTION public.pf_decline_spot(p_game uuid, p_person uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  g pf_games%ROWTYPE;
BEGIN
  SELECT * INTO g FROM pf_games WHERE id = p_game;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  IF pf_poster_person(p_game) = p_person THEN
    RETURN jsonb_build_object('result', 'own_game');
  END IF;

  IF NOT pf_is_person_of_club(g.club_id, p_person) THEN
    RETURN jsonb_build_object('result', 'not_member');
  END IF;

  IF EXISTS (SELECT 1 FROM pf_game_players WHERE game_id = p_game AND person_id = p_person AND status = 'in') THEN
    RETURN jsonb_build_object('result', 'already_in');
  END IF;

  INSERT INTO pf_game_players (game_id, club_id, person_id, user_id, status, via, left_at)
  VALUES (p_game, g.club_id, p_person,
          (SELECT v.user_id FROM cc_vault_players v WHERE v.id = p_person),
          'no', 'email', now())
  ON CONFLICT (game_id, person_id)
  DO UPDATE SET status = 'no', left_at = now();

  RETURN jsonb_build_object('result', 'declined');
END;
$function$;

DROP FUNCTION IF EXISTS public.pf_cancel_game(uuid, uuid);
CREATE FUNCTION public.pf_cancel_game(p_game uuid, p_person uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  g pf_games%ROWTYPE;
BEGIN
  SELECT * INTO g FROM pf_games WHERE id = p_game FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;
  IF pf_poster_person(p_game) IS DISTINCT FROM p_person THEN
    RETURN jsonb_build_object('result', 'not_poster');
  END IF;
  IF g.status = 'cancelled' THEN
    RETURN jsonb_build_object('result', 'already_cancelled');
  END IF;
  IF g.status = 'expired' OR g.starts_at <= now() THEN
    RETURN jsonb_build_object('result', 'past');
  END IF;

  UPDATE pf_games SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = p_game;
  RETURN jsonb_build_object('result', 'cancelled');
END;
$function$;

REVOKE ALL ON FUNCTION pf_claim_spot(uuid, uuid, text)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pf_leave_spot(uuid, uuid)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pf_decline_spot(uuid, uuid)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pf_cancel_game(uuid, uuid)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pf_poster_person(uuid)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pf_is_person_of_club(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pf_claim_spot(uuid, uuid, text)  TO service_role;
GRANT EXECUTE ON FUNCTION pf_leave_spot(uuid, uuid)        TO service_role;
GRANT EXECUTE ON FUNCTION pf_decline_spot(uuid, uuid)      TO service_role;
GRANT EXECUTE ON FUNCTION pf_cancel_game(uuid, uuid)       TO service_role;
GRANT EXECUTE ON FUNCTION pf_poster_person(uuid)           TO service_role;
GRANT EXECUTE ON FUNCTION pf_is_person_of_club(uuid, uuid) TO service_role;
