-- CourtConnect: a friend the host took off a game stays off (2026-10-27).
--
-- QA found it the same afternoon pf_host_remove.sql went in: the host removed
-- Jordan (an invited friend), and Jordan's own link went back to "Hi Jordan,
-- this game needs 1 player -- Yes, I'm in". One tap and he was back on the
-- court the host had just taken him off.
--
-- pf_host_remove marked the link 'left', the same word a friend's own "I can't
-- make it" leaves behind, so nothing could tell the two apart. A host removal
-- is now 'removed':
--
--   * the friend's page says the organizer took them off, with no join button;
--   * pf_guest_claim and pf_guest_answer refuse a 'removed' link, so the
--     button being gone is not the only thing standing in the way;
--   * the host can still invite them again on purpose (inviteGuests resets a
--     'removed' link to 'invited'), because it is the host's game.
--
-- Safe to re-run. Nothing else changes in the three functions.

alter table pf_guest_links drop constraint if exists pf_guest_links_status_check;
alter table pf_guest_links add constraint pf_guest_links_status_check
  check (status in ('invited', 'in', 'no', 'left', 'removed'));

comment on column pf_guest_links.status is
  'invited | in | no | left (the friend dropped out) | removed (the host took them off).';

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

-- The friend taps "I'm in". Unchanged from pf_guest_invites.sql except that a
-- link the host took off is refused.
create or replace function public.pf_guest_claim(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  l pf_guest_links%ROWTYPE;
  g pf_games%ROWTYPE;
  c pf_guest_contacts%ROWTYPE;
  taken integer;
  seat uuid;
BEGIN
  SELECT * INTO l FROM pf_guest_links WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
  SELECT * INTO g FROM pf_games WHERE id = l.game_id FOR UPDATE;
  IF g.status = 'cancelled' THEN RETURN jsonb_build_object('result', 'cancelled'); END IF;
  IF g.status = 'expired' OR g.starts_at <= now() THEN RETURN jsonb_build_object('result', 'past'); END IF;
  -- Re-read under the game lock so a double tap cannot seat twice.
  SELECT * INTO l FROM pf_guest_links WHERE token = p_token FOR UPDATE;
  IF l.status = 'in' THEN RETURN jsonb_build_object('result', 'already_in'); END IF;
  IF l.status = 'removed' THEN RETURN jsonb_build_object('result', 'removed'); END IF;

  SELECT count(*) INTO taken FROM pf_game_players WHERE game_id = g.id AND status = 'in';
  IF taken >= g.spots_needed THEN RETURN jsonb_build_object('result', 'full'); END IF;

  SELECT * INTO c FROM pf_guest_contacts WHERE id = l.contact_id;
  INSERT INTO pf_game_players (game_id, club_id, person_id, user_id, status, via, guest_name, guest_contact_id, joined_at)
  VALUES (g.id, g.club_id, NULL, NULL, 'in', 'email', c.name, c.id, now())
  RETURNING id INTO seat;
  UPDATE pf_guest_links SET status = 'in', seat_id = seat, answered_at = now() WHERE token = p_token;

  taken := taken + 1;
  IF taken >= g.spots_needed THEN
    UPDATE pf_games SET status = 'full', filled_at = now(), updated_at = now() WHERE id = g.id;
  END IF;
  RETURN jsonb_build_object('result', 'joined', 'now_full', taken >= g.spots_needed, 'name', c.name);
END;
$function$;

-- The friend drops out or says no. Unchanged except that a removed link
-- cannot be turned into a 'no' -- which pf_guest_claim would then accept.
create or replace function public.pf_guest_answer(p_token text, p_answer text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  l pf_guest_links%ROWTYPE;
  g pf_games%ROWTYPE;
  was_full boolean;
BEGIN
  SELECT * INTO l FROM pf_guest_links WHERE token = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('result', 'not_found'); END IF;
  SELECT * INTO g FROM pf_games WHERE id = l.game_id FOR UPDATE;
  SELECT * INTO l FROM pf_guest_links WHERE token = p_token FOR UPDATE;
  IF l.status = 'removed' THEN RETURN jsonb_build_object('result', 'removed'); END IF;

  IF p_answer = 'no' THEN
    IF l.status = 'in' THEN RETURN jsonb_build_object('result', 'already_in'); END IF;
    UPDATE pf_guest_links SET status = 'no', answered_at = now() WHERE token = p_token;
    RETURN jsonb_build_object('result', 'declined');
  END IF;

  IF p_answer <> 'leave' THEN RETURN jsonb_build_object('result', 'error'); END IF;
  IF l.status <> 'in' THEN RETURN jsonb_build_object('result', 'not_in'); END IF;
  IF g.status = 'cancelled' THEN RETURN jsonb_build_object('result', 'cancelled'); END IF;
  IF g.starts_at <= now() THEN RETURN jsonb_build_object('result', 'past'); END IF;

  UPDATE pf_game_players SET status = 'out', left_at = now() WHERE id = l.seat_id;
  UPDATE pf_guest_links SET status = 'left', answered_at = now() WHERE token = p_token;
  was_full := g.status = 'full';
  IF was_full THEN
    UPDATE pf_games SET status = 'open', filled_at = NULL, reminder_sent_at = NULL, updated_at = now() WHERE id = g.id;
  END IF;
  RETURN jsonb_build_object('result', 'left', 'reopened', was_full);
END;
$function$;

revoke all on function public.pf_host_remove(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.pf_host_remove(uuid, uuid, uuid) to service_role;
revoke all on function public.pf_guest_claim(text) from public, anon, authenticated;
revoke all on function public.pf_guest_answer(text, text) from public, anon, authenticated;
