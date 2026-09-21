-- A full game keeps taking answers.
--
-- Until now, tapping "I'm in" one second after a game filled got you "This
-- game just filled. We'll tell you about the next one." — and CourtConnect
-- then forgot you. That is the wrong end of the two most common things that
-- happen next: somebody drops out the morning of, or the poster would happily
-- take a fifth and split sets.
--
-- So a claim on a full game becomes a WAITLIST row, in tap order. Nothing is
-- promoted automatically: when a spot opens, everyone waiting is emailed and
-- the first to tap takes it, which is the same rule the game itself runs on
-- and the only one that is fair when a person's plans may have changed since
-- they answered.
--
-- 'wait' joins 'in' and 'out' on pf_game_players. joined_at is the queue
-- order, and the UNIQUE (game_id, user_id) means one row per person however
-- often they change their mind.
--
-- Safe to re-run.

ALTER TABLE pf_game_players DROP CONSTRAINT IF EXISTS pf_game_players_status_check;
ALTER TABLE pf_game_players ADD CONSTRAINT pf_game_players_status_check
  CHECK (status = ANY (ARRAY['in'::text, 'out'::text, 'wait'::text]));

-- pf_claim_spot, with one branch changed: a full game waitlists instead of
-- refusing. Everything else is as it was in partner_finder.sql.
CREATE OR REPLACE FUNCTION pf_claim_spot(p_game uuid, p_user uuid, p_via text DEFAULT 'board')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  g pf_games%ROWTYPE;
  taken integer;
  waiting integer;
BEGIN
  SELECT * INTO g FROM pf_games WHERE id = p_game FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  IF g.posted_by = p_user THEN
    RETURN jsonb_build_object('result', 'own_game');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cc_club_members m
     WHERE m.club_id = g.club_id AND m.user_id = p_user AND m.role <> 'maintenance'
  ) THEN
    RETURN jsonb_build_object('result', 'not_member');
  END IF;

  SELECT count(*) INTO taken FROM pf_game_players WHERE game_id = p_game AND status = 'in';

  IF EXISTS (SELECT 1 FROM pf_game_players WHERE game_id = p_game AND user_id = p_user AND status = 'in') THEN
    RETURN jsonb_build_object('result', 'already_in', 'spots_left', greatest(g.spots_needed - taken, 0));
  END IF;

  -- A cancelled or finished game is over for everyone, waitlist included.
  IF g.status = 'cancelled' THEN
    RETURN jsonb_build_object('result', 'cancelled');
  END IF;
  IF g.status = 'expired' OR g.starts_at <= now() THEN
    RETURN jsonb_build_object('result', 'past');
  END IF;

  IF g.status = 'full' OR taken >= g.spots_needed THEN
    IF EXISTS (SELECT 1 FROM pf_game_players WHERE game_id = p_game AND user_id = p_user AND status = 'wait') THEN
      SELECT count(*) INTO waiting
        FROM pf_game_players w
       WHERE w.game_id = p_game AND w.status = 'wait'
         AND w.joined_at <= (SELECT joined_at FROM pf_game_players
                              WHERE game_id = p_game AND user_id = p_user);
      RETURN jsonb_build_object('result', 'already_waiting', 'position', waiting);
    END IF;

    INSERT INTO pf_game_players (game_id, club_id, user_id, status, via, joined_at, left_at)
    VALUES (p_game, g.club_id, p_user, 'wait',
            CASE WHEN p_via = 'email' THEN 'email' ELSE 'board' END, now(), NULL)
    ON CONFLICT (game_id, user_id)
    DO UPDATE SET status = 'wait', via = EXCLUDED.via, joined_at = now(), left_at = NULL;

    SELECT count(*) INTO waiting FROM pf_game_players WHERE game_id = p_game AND status = 'wait';
    RETURN jsonb_build_object('result', 'waitlisted', 'position', waiting);
  END IF;

  INSERT INTO pf_game_players (game_id, club_id, user_id, status, via)
  VALUES (p_game, g.club_id, p_user, 'in', CASE WHEN p_via = 'email' THEN 'email' ELSE 'board' END)
  ON CONFLICT (game_id, user_id)
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
$$;

-- Leaving is unchanged except that it now reports how many people are waiting,
-- so the caller knows whether there is anyone to tell about the open spot.
CREATE OR REPLACE FUNCTION pf_leave_spot(p_game uuid, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  g pf_games%ROWTYPE;
  was_full boolean;
  waiting integer;
BEGIN
  SELECT * INTO g FROM pf_games WHERE id = p_game FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pf_game_players WHERE game_id = p_game AND user_id = p_user AND status = 'in') THEN
    -- Someone who is only WAITING can step off the list, and that is not a
    -- spot opening: nothing reopens and nobody is told.
    IF EXISTS (SELECT 1 FROM pf_game_players WHERE game_id = p_game AND user_id = p_user AND status = 'wait') THEN
      UPDATE pf_game_players SET status = 'out', left_at = now()
       WHERE game_id = p_game AND user_id = p_user;
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

  UPDATE pf_game_players SET status = 'out', left_at = now() WHERE game_id = p_game AND user_id = p_user;

  was_full := g.status = 'full';
  IF was_full THEN
    UPDATE pf_games SET status = 'open', filled_at = NULL, reminder_sent_at = NULL, updated_at = now()
     WHERE id = p_game;
  END IF;

  SELECT count(*) INTO waiting FROM pf_game_players WHERE game_id = p_game AND status = 'wait';

  RETURN jsonb_build_object('result', 'left', 'reopened', was_full, 'waiting', waiting);
END;
$$;

-- Nobody is invited twice: someone already in, waiting, or who has said no is
-- not a candidate for the "this game needs players" blast.
CREATE OR REPLACE FUNCTION pf_game_recipients(p_game uuid, p_limit integer DEFAULT 50)
RETURNS TABLE (user_id uuid, email text, full_name text, ntrp numeric, stop_token text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT r.user_id, r.email, r.full_name, r.ntrp, r.stop_token
  FROM pf_games g
  CROSS JOIN LATERAL pf_member_roster(g.club_id) r
  WHERE g.id = p_game
    AND r.user_id <> g.posted_by
    AND r.email IS NOT NULL
    AND r.notify_games
    AND NOT EXISTS (
      SELECT 1 FROM pf_game_players gp
       WHERE gp.game_id = g.id AND gp.user_id = r.user_id AND gp.status IN ('in', 'wait')
    )
    AND NOT EXISTS (
      SELECT 1 FROM email_unsubscribes eu
       WHERE eu.email = lower(r.email) AND eu.scope = 'all'
    )
    AND (
      (g.rating_min IS NULL AND g.rating_max IS NULL)
      OR (r.ntrp IS NULL AND g.include_unrated)
      OR (r.ntrp IS NOT NULL
          AND r.ntrp >= coalesce(g.rating_min, 1.0)
          AND r.ntrp <= coalesce(g.rating_max, 7.0))
    )
  ORDER BY
    (r.ntrp IS NULL),
    abs(coalesce(r.ntrp, 0) - (coalesce(g.rating_min, 1.0) + coalesce(g.rating_max, 7.0)) / 2),
    random()
  LIMIT greatest(p_limit, 0);
$$;
