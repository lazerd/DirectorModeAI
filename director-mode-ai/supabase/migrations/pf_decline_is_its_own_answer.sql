-- A "no" is an answer, not an absence.
--
-- pf_decline_spot stored a decline as status 'out' — the same value a player
-- who gives up a spot gets. That made the two indistinguishable, so the
-- director's page could not show what the director most wants to know on the
-- morning of a game: of the sixteen people we wrote to, who has actually
-- answered? Adam Branson said no eleven minutes after the blast went out and
-- there was nowhere to see it.
--
-- 'no' is now its own status. It also takes someone out of the running for
-- this game's later emails: they have answered, and asking twice is how a
-- club teaches its members to ignore it.
--
-- Changing their mind still works: pf_claim_spot's ON CONFLICT flips any row
-- to 'in'. The tap they already have in their inbox is enough.
--
-- Safe to re-run.

ALTER TABLE pf_game_players DROP CONSTRAINT IF EXISTS pf_game_players_status_check;
ALTER TABLE pf_game_players ADD CONSTRAINT pf_game_players_status_check
  CHECK (status = ANY (ARRAY['in'::text, 'out'::text, 'wait'::text, 'no'::text]));

-- Existing declines carry the signature of the old INSERT: it set joined_at
-- and left_at to the same now(), from an email tap. A player who left a game
-- has a joined_at from earlier.
UPDATE pf_game_players
   SET status = 'no'
 WHERE status = 'out'
   AND via = 'email'
   AND left_at IS NOT NULL
   AND joined_at = left_at;

CREATE OR REPLACE FUNCTION public.pf_decline_spot(p_game uuid, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  g pf_games%ROWTYPE;
BEGIN
  SELECT * INTO g FROM pf_games WHERE id = p_game;
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

  IF EXISTS (SELECT 1 FROM pf_game_players WHERE game_id = p_game AND user_id = p_user AND status = 'in') THEN
    RETURN jsonb_build_object('result', 'already_in');
  END IF;

  INSERT INTO pf_game_players (game_id, club_id, user_id, status, via, left_at)
  VALUES (p_game, g.club_id, p_user, 'no', 'email', now())
  ON CONFLICT (game_id, user_id)
  DO UPDATE SET status = 'no', left_at = now();

  RETURN jsonb_build_object('result', 'declined');
END;
$$;

-- Someone who has answered no is not asked again about this game.
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
       WHERE gp.game_id = g.id AND gp.user_id = r.user_id AND gp.status IN ('in', 'wait', 'no')
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
