-- CourtConnect: a poster invites their OWN friends from outside the club (2026-09-30).
--
-- Walden asked: when the club can't fill his four, he wants to ask his friends
-- from Chabot Canyon. They are not Sleepy Hollow members, so they must never
-- land in PlayerVault (cc_vault_players is members only -- Darrin, 2026-09-22).
--
--   pf_guest_contacts  -- the POSTER's personal list of outside friends, kept
--                         per poster (owner_person_id), reused across games.
--                         Nobody else at the club sees or emails it.
--   pf_guest_links     -- one secret link per (game, contact): the invite. A
--                         tap on it seats the friend as a named guest.
--
-- A seated friend is an ordinary guest seat (person_id null, guest_name set,
-- see pf_host_add.sql) that also remembers which contact it came from, so the
-- group emails can reach them and they can drop out from their own link.

create table if not exists pf_guest_contacts (
  id              uuid primary key default gen_random_uuid(),
  club_id         uuid not null,
  owner_person_id uuid not null references cc_vault_players(id) on delete cascade,
  name            text not null check (length(btrim(name)) > 0),
  email           text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  created_at      timestamptz not null default now()
);
create unique index if not exists pf_guest_contacts_owner_email
  on pf_guest_contacts (owner_person_id, lower(email));

comment on table pf_guest_contacts is
  'A CourtConnect poster''s own outside friends. NOT members, never PlayerVault rows. Visible only to their owner.';

create table if not exists pf_guest_links (
  token       text primary key default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  game_id     uuid not null references pf_games(id) on delete cascade,
  club_id     uuid not null,
  contact_id  uuid not null references pf_guest_contacts(id) on delete cascade,
  status      text not null default 'invited' check (status in ('invited', 'in', 'no', 'left')),
  seat_id     uuid references pf_game_players(id) on delete set null,
  emailed_at  timestamptz,
  answered_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (game_id, contact_id)
);

alter table pf_game_players
  add column if not exists guest_contact_id uuid references pf_guest_contacts(id) on delete set null;

-- Service role only: every read and write goes through the token routes.
alter table pf_guest_contacts enable row level security;
alter table pf_guest_links enable row level security;
revoke all on pf_guest_contacts from anon, authenticated;
revoke all on pf_guest_links from anon, authenticated;

-- The friend taps "I'm in". Same lock and capacity rule as a member's tap, so
-- a friend and a member racing for the last spot cannot both get it. Friends
-- are not put in line when it is full: the line is for members.
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

-- The friend drops out (or says no before joining). Mirrors pf_leave_spot:
-- a full game reopens and its reminder resets.
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

revoke all on function public.pf_guest_claim(text) from public, anon, authenticated;
revoke all on function public.pf_guest_answer(text, text) from public, anon, authenticated;
