-- "No, not this time."
--
-- CourtConnect only ever offered one answer: I'm in. A member who could not
-- play had nothing to tap, so the invitation sat there and the poster learned
-- nothing from silence. A yes/no question needs both answers on the page.
--
-- A decline writes the same 'out' row that leaving a game writes, so:
--   * pf_claim_spot's ON CONFLICT flips it back to 'in' if they change their
--     mind from the very same email. Declining is never a door that locks.
--   * nobody is told. A "no" is not news for the poster the way a "yes" is,
--     and CourtConnect's whole promise is that it does not fill the club's
--     inbox.
--
-- Someone who is already IN the game gets 'already_in' back: giving up a spot
-- is pf_leave_spot's job, because that one has to reopen a full game and tell
-- the poster.
--
-- Safe to re-run.

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
  VALUES (p_game, g.club_id, p_user, 'out', 'email', now())
  ON CONFLICT (game_id, user_id)
  DO UPDATE SET status = 'out', left_at = now();

  RETURN jsonb_build_object('result', 'declined');
END;
$$;
