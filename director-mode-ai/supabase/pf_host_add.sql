-- CourtConnect: let the host seat someone themselves (2026-09-22).
--
-- Walden asked for this after running his first game: people tell him yes on
-- court, in a text, in the parking lot. Until now the only way into a game was
-- tapping a button in an email, so a verbal yes had nowhere to go and the game
-- sat looking half-empty while everyone involved knew it was full.
--
-- Two kinds of person, and the difference matters:
--
--   a MEMBER  -- has a cc_vault_players row. Seated by person_id, exactly like
--               a tap, so every later email, drop-out and line-up includes
--               them properly.
--   a GUEST   -- somebody's visiting partner. Has NO row anywhere and must not
--               get one: PlayerVault is Sleepy Hollow members only (Darrin,
--               2026-09-22). A guest is a name on THIS game and nothing more,
--               which is what guest_name is for.
--
-- Seats taken this way are `via = 'host'`. They are on the court but they never
-- answered an email, so the director's board keeps counting them apart from a
-- real yes -- the same rule that already separates "added by staff".

alter table pf_game_players
  add column if not exists guest_name text;

comment on column pf_game_players.guest_name is
  'A guest seated by the host: not a member, has no cc_vault_players row, and must never be given one. Null for members.';

alter table pf_game_players drop constraint if exists pf_game_players_via_check;
alter table pf_game_players add constraint pf_game_players_via_check
  check (via = any (array['email', 'board', 'host']));

-- A row is either a person or a named guest, never neither and never both.
alter table pf_game_players drop constraint if exists pf_game_players_person_or_guest_chk;
alter table pf_game_players add constraint pf_game_players_person_or_guest_chk check (
  (person_id is not null and guest_name is null)
  or (person_id is null and guest_name is not null and length(btrim(guest_name)) > 0)
);

create or replace function public.pf_host_add(
  p_game uuid,
  p_actor uuid,
  p_person uuid default null,
  p_guest_name text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  g pf_games%ROWTYPE;
  taken integer;
  guest text := nullif(btrim(coalesce(p_guest_name, '')), '');
  seated_name text;
BEGIN
  SELECT * INTO g FROM pf_games WHERE id = p_game FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  -- Only the person who posted it may seat anyone. Same rule as cancelling.
  IF pf_poster_person(p_game) IS DISTINCT FROM p_actor THEN
    RETURN jsonb_build_object('result', 'not_poster');
  END IF;

  IF g.status = 'cancelled' THEN
    RETURN jsonb_build_object('result', 'cancelled');
  END IF;
  IF g.status = 'expired' OR g.starts_at <= now() THEN
    RETURN jsonb_build_object('result', 'past');
  END IF;

  IF (p_person IS NULL) = (guest IS NULL) THEN
    RETURN jsonb_build_object('result', 'need_one');
  END IF;

  SELECT count(*) INTO taken FROM pf_game_players WHERE game_id = p_game AND status = 'in';
  IF taken >= g.spots_needed THEN
    RETURN jsonb_build_object('result', 'full');
  END IF;

  IF p_person IS NOT NULL THEN
    IF pf_poster_person(p_game) = p_person THEN
      RETURN jsonb_build_object('result', 'own_game');
    END IF;
    IF NOT pf_is_person_of_club(g.club_id, p_person) THEN
      RETURN jsonb_build_object('result', 'not_member');
    END IF;
    IF EXISTS (SELECT 1 FROM pf_game_players
                WHERE game_id = p_game AND person_id = p_person AND status = 'in') THEN
      RETURN jsonb_build_object('result', 'already_in');
    END IF;

    INSERT INTO pf_game_players (game_id, club_id, person_id, user_id, status, via, joined_at, left_at)
    VALUES (p_game, g.club_id, p_person,
            (SELECT v.user_id FROM cc_vault_players v WHERE v.id = p_person),
            'in', 'host', now(), NULL)
    ON CONFLICT (game_id, person_id)
    DO UPDATE SET status = 'in', via = 'host', joined_at = now(), left_at = NULL;

    SELECT v.full_name INTO seated_name FROM cc_vault_players v WHERE v.id = p_person;
  ELSE
    -- Guests are distinct rows with a null person_id, so a host may add two of
    -- them without one displacing the other.
    INSERT INTO pf_game_players (game_id, club_id, person_id, user_id, status, via, guest_name, joined_at)
    VALUES (p_game, g.club_id, NULL, NULL, 'in', 'host', guest, now());
    seated_name := guest;
  END IF;

  SELECT count(*) INTO taken FROM pf_game_players WHERE game_id = p_game AND status = 'in';
  IF taken >= g.spots_needed THEN
    UPDATE pf_games SET status = 'full', filled_at = now(), updated_at = now() WHERE id = p_game;
  END IF;

  RETURN jsonb_build_object(
    'result', 'added',
    'now_full', taken >= g.spots_needed,
    'is_guest', p_person IS NULL,
    'name', coalesce(seated_name, 'A member')
  );
END;
$function$;

revoke all on function public.pf_host_add(uuid, uuid, uuid, text) from public, anon, authenticated;
