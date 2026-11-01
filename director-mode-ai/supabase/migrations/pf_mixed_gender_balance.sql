-- Mixed doubles keeps the court even.
--
-- Asked for by Walden Browne (2026-11-01): he posts a mixed game and wants
-- himself, two women and one more man -- not whoever taps first. pf_claim_spot
-- now caps each gender at half the court, the host counted. Safe to re-run.

CREATE OR REPLACE FUNCTION public.pf_claim_spot(p_game uuid, p_person uuid, p_via text DEFAULT 'board'::text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  g pf_games%ROWTYPE;
  taken integer;
  waiting integer;
  my_gender text;
  same_gender integer;
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

  -- Mixed doubles stays even: no more than half the court (host included, rounded up) of
  -- one gender. A man who taps once both men's seats are taken goes in line,
  -- like a full game. Unknown gender is let through; the host can still seat
  -- anyone by hand (pf_host_add).
  IF g.format = 'mixed' THEN
    SELECT lower(v.gender) INTO my_gender FROM cc_vault_players v WHERE v.id = p_person;
    IF my_gender IN ('male', 'female') THEN
      SELECT count(*) INTO same_gender
        FROM cc_vault_players v
       WHERE lower(v.gender) = my_gender
         AND (v.id = pf_poster_person(p_game)
              OR v.id IN (SELECT person_id FROM pf_game_players
                           WHERE game_id = p_game AND status = 'in' AND person_id IS NOT NULL));
      IF same_gender >= (g.spots_needed + 2) / 2 AND taken < g.spots_needed THEN
        INSERT INTO pf_game_players (game_id, club_id, person_id, user_id, status, via, joined_at, left_at)
        VALUES (p_game, g.club_id, p_person,
                (SELECT v.user_id FROM cc_vault_players v WHERE v.id = p_person),
                'wait', CASE WHEN p_via = 'email' THEN 'email' ELSE 'board' END, now(), NULL)
        ON CONFLICT (game_id, person_id)
        DO UPDATE SET status = 'wait', via = EXCLUDED.via, joined_at = now(), left_at = NULL;
        RETURN jsonb_build_object('result', 'gender_full', 'gender', my_gender);
      END IF;
    END IF;
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
