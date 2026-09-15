-- ============================================================================
-- Partner Finder ("Find a Game")
--
-- A member posts "need 1 for doubles, Tue 9am, 3.0-3.5". Members of THAT club
-- whose level fits get an email with a one-tap "I'm in" link. First to tap wins.
--
-- Club-scoped from the first column. CourtConnect's cc_events has no club_id,
-- so its public games show to every account on the platform; nothing here is
-- readable outside the club it was posted at.
--
-- Every write goes through the service role (API routes), and the parts that
-- must be race-free live in Postgres functions below:
--   pf_post_game    — membership + daily post limit + insert, under one lock
--   pf_claim_spot   — row-locks the game, so two taps on the last spot can
--                     never both win
--   pf_leave_spot   — gives a spot back and re-opens a full game
--   pf_cancel_game  — the poster calls it off
--
-- Idempotent: safe to run twice.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- NTRP lives on the person.
--
-- A number that describes a player goes on master_players (the identity hub),
-- never on a tool's own row — same rule as WTN. A member who tells us their
-- level on their first post or claim is writing it here.
-- ----------------------------------------------------------------------------
ALTER TABLE master_players ADD COLUMN IF NOT EXISTS ntrp numeric(2,1);
ALTER TABLE master_players ADD COLUMN IF NOT EXISTS ntrp_source text;
ALTER TABLE master_players ADD COLUMN IF NOT EXISTS ntrp_updated_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'master_players_ntrp_band_chk') THEN
    ALTER TABLE master_players ADD CONSTRAINT master_players_ntrp_band_chk
      CHECK (ntrp IS NULL OR (ntrp >= 1.0 AND ntrp <= 7.0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'master_players_ntrp_source_chk') THEN
    ALTER TABLE master_players ADD CONSTRAINT master_players_ntrp_source_chk
      CHECK (ntrp_source IS NULL OR ntrp_source IN ('self', 'director', 'usta'));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Tables
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pf_games (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id          uuid NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  posted_by        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  starts_at        timestamptz NOT NULL,
  duration_min     integer NOT NULL DEFAULT 90 CHECK (duration_min BETWEEN 30 AND 240),
  format           text NOT NULL CHECK (format IN ('singles', 'doubles', 'mixed', 'hitting')),
  spots_needed     smallint NOT NULL CHECK (spots_needed BETWEEN 1 AND 3),
  rating_min       numeric(2,1) CHECK (rating_min IS NULL OR rating_min BETWEEN 1.0 AND 7.0),
  rating_max       numeric(2,1) CHECK (rating_max IS NULL OR rating_max BETWEEN 1.0 AND 7.0),
  include_unrated  boolean NOT NULL DEFAULT true,
  court            text CHECK (court IS NULL OR length(court) <= 60),
  note             text CHECK (note IS NULL OR length(note) <= 500),
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'full', 'cancelled', 'expired')),
  notified_count   integer NOT NULL DEFAULT 0,
  filled_at        timestamptz,
  cancelled_at     timestamptz,
  reminder_sent_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pf_games_rating_order CHECK (rating_min IS NULL OR rating_max IS NULL OR rating_min <= rating_max)
);
CREATE INDEX IF NOT EXISTS idx_pf_games_club_starts ON pf_games (club_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_pf_games_poster ON pf_games (posted_by, created_at);
CREATE INDEX IF NOT EXISTS idx_pf_games_status_starts ON pf_games (status, starts_at);

-- Who took a spot. The poster is NOT a row here; they own the game.
CREATE TABLE IF NOT EXISTS pf_game_players (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id   uuid NOT NULL REFERENCES pf_games(id) ON DELETE CASCADE,
  club_id   uuid NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status    text NOT NULL DEFAULT 'in' CHECK (status IN ('in', 'out')),
  via       text NOT NULL DEFAULT 'board' CHECK (via IN ('email', 'board')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at   timestamptz,
  UNIQUE (game_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_pf_game_players_user ON pf_game_players (user_id, status);

/*
 * One secret link per (game, person). It is the whole credential for the
 * no-login pages — "I'm in", "I can't make it", "cancel the game" — so it is
 * never readable through any client policy.
 */
CREATE TABLE IF NOT EXISTS pf_links (
  token      text PRIMARY KEY DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  game_id    uuid NOT NULL REFERENCES pf_games(id) ON DELETE CASCADE,
  club_id    uuid NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  emailed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, user_id)
);

-- Per-club preferences. "Email me when a game needs players" defaults ON.
CREATE TABLE IF NOT EXISTS pf_member_prefs (
  club_id      uuid NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notify_games boolean NOT NULL DEFAULT true,
  share_phone  boolean NOT NULL DEFAULT false,
  phone        text CHECK (phone IS NULL OR length(phone) <= 30),
  stop_token   text NOT NULL UNIQUE DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, user_id)
);

-- ----------------------------------------------------------------------------
-- RLS
--
-- The app reads through the service role and checks membership itself; these
-- policies are the floor underneath that, for anyone holding a session token:
--   * staff (is_club_team) read every game at their club
--   * a member reads open games at their own club, plus games they posted or
--     are in — and only the non-identifying columns (see the GRANT below)
--   * nobody reads another member's prefs (phone lives there) or any link
--   * other clubs and anon read nothing
-- ----------------------------------------------------------------------------
ALTER TABLE pf_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_game_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_member_prefs ENABLE ROW LEVEL SECURITY;

-- Helper for the member policy. SECURITY DEFINER so the pf_games policy does
-- not recurse through pf_game_players' own policy.
CREATE OR REPLACE FUNCTION pf_in_game(target_game uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM pf_game_players gp
     WHERE gp.game_id = target_game AND gp.user_id = auth.uid() AND gp.status = 'in'
  );
$$;

DROP POLICY IF EXISTS "pf_games team reads club" ON pf_games;
CREATE POLICY "pf_games team reads club" ON pf_games
  FOR SELECT USING (is_club_team(club_id));

DROP POLICY IF EXISTS "pf_games members read open or own" ON pf_games;
CREATE POLICY "pf_games members read open or own" ON pf_games
  FOR SELECT USING (
    is_club_member(club_id)
    AND (status = 'open' OR posted_by = auth.uid() OR pf_in_game(id))
  );

DROP POLICY IF EXISTS "pf_game_players own or team" ON pf_game_players;
CREATE POLICY "pf_game_players own or team" ON pf_game_players
  FOR SELECT USING (user_id = auth.uid() OR is_club_team(club_id));

DROP POLICY IF EXISTS "pf_member_prefs own row" ON pf_member_prefs;
CREATE POLICY "pf_member_prefs own row" ON pf_member_prefs
  FOR SELECT USING (user_id = auth.uid());

-- pf_links: RLS on, no policies. Service role only.

/*
 * Column-level: a session can read what a game IS, not the free-text the
 * poster typed. The note and court can carry a name or a phone number, and a
 * direct API read must not be a way around the board's own rendering.
 */
REVOKE ALL ON pf_games FROM anon, authenticated;
REVOKE ALL ON pf_game_players FROM anon, authenticated;
REVOKE ALL ON pf_links FROM anon, authenticated;
REVOKE ALL ON pf_member_prefs FROM anon, authenticated;
GRANT SELECT (id, club_id, starts_at, duration_min, format, spots_needed, rating_min, rating_max,
              include_unrated, status, filled_at, created_at)
  ON pf_games TO authenticated;
GRANT SELECT (id, game_id, club_id, user_id, status, joined_at) ON pf_game_players TO authenticated;
GRANT SELECT (club_id, user_id, notify_games, share_phone, phone) ON pf_member_prefs TO authenticated;
GRANT ALL ON pf_games, pf_game_players, pf_links, pf_member_prefs TO service_role;

-- ----------------------------------------------------------------------------
-- The club's playing roster, with each person's level.
--
-- Level resolution, in order:
--   1. the club's own PlayerVault rating (cc_vault_players.usta_rating on the
--      owner's vault, matched by email) — the club's word wins over a self-rating
--   2. the person's NTRP on master_players
-- The maintenance crew is not a playing member and is never listed.
--
-- Service role only: this joins auth.users for email addresses.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pf_member_roster(p_club uuid, p_user uuid DEFAULT NULL)
RETURNS TABLE (
  user_id uuid, email text, full_name text, role text,
  ntrp numeric, ntrp_source text,
  notify_games boolean, share_phone boolean, phone text, stop_token text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    m.user_id,
    u.email::text,
    coalesce(
      nullif(trim(p.full_name), ''),
      nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(u.raw_user_meta_data->>'name'), '')
    ) AS full_name,
    m.role,
    coalesce(v.usta_rating, mp.ntrp) AS ntrp,
    CASE WHEN v.usta_rating IS NOT NULL THEN 'club'
         WHEN mp.ntrp IS NOT NULL THEN coalesce(mp.ntrp_source, 'self') END AS ntrp_source,
    coalesce(pr.notify_games, true),
    coalesce(pr.share_phone, false),
    pr.phone,
    pr.stop_token
  FROM cc_club_members m
  JOIN cc_clubs c ON c.id = m.club_id
  JOIN auth.users u ON u.id = m.user_id
  LEFT JOIN profiles p ON p.id = m.user_id
  LEFT JOIN pf_member_prefs pr ON pr.club_id = m.club_id AND pr.user_id = m.user_id
  LEFT JOIN LATERAL (
    SELECT vp.usta_rating FROM cc_vault_players vp
     WHERE vp.director_id = c.owner_id
       AND u.email IS NOT NULL
       AND lower(trim(vp.email)) = lower(u.email)
       AND vp.usta_rating IS NOT NULL
     ORDER BY vp.updated_at DESC NULLS LAST
     LIMIT 1
  ) v ON true
  LEFT JOIN LATERAL (
    SELECT mpl.ntrp, mpl.ntrp_source FROM master_players mpl
     WHERE u.email IS NOT NULL
       AND mpl.email_normalized = lower(u.email)
       AND mpl.ntrp IS NOT NULL
     ORDER BY mpl.ntrp_updated_at DESC NULLS LAST
     LIMIT 1
  ) mp ON true
  WHERE m.club_id = p_club
    AND m.role <> 'maintenance'
    AND (p_user IS NULL OR m.user_id = p_user);
$$;

/*
 * Who gets the "a game needs players" email.
 *
 * In range, or unrated when the poster allowed it; not the poster; not already
 * in; notifications on; not globally unsubscribed. Closest to the middle of the
 * range first, unrated last, so the cap trims the worst fits rather than
 * whoever joined the club most recently.
 */
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
       WHERE gp.game_id = g.id AND gp.user_id = r.user_id AND gp.status = 'in'
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

-- ----------------------------------------------------------------------------
-- Post a game.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pf_post_game(
  p_club uuid,
  p_user uuid,
  p_starts_at timestamptz,
  p_duration integer,
  p_format text,
  p_spots integer,
  p_rating_min numeric,
  p_rating_max numeric,
  p_include_unrated boolean,
  p_court text,
  p_note text,
  p_daily_limit integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  recent integer;
  new_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cc_club_members m
     WHERE m.club_id = p_club AND m.user_id = p_user AND m.role <> 'maintenance'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_member');
  END IF;

  IF p_starts_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'in_past');
  END IF;
  IF p_starts_at > now() + interval '60 days' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too_far');
  END IF;

  -- Serialise this person's posts so the limit cannot be raced.
  PERFORM pg_advisory_xact_lock(hashtext('pf_post:' || p_user::text));
  SELECT count(*) INTO recent FROM pf_games
   WHERE posted_by = p_user AND club_id = p_club AND created_at > now() - interval '24 hours';
  IF recent >= p_daily_limit THEN
    RETURN jsonb_build_object('ok', false, 'error', 'rate_limited', 'limit', p_daily_limit);
  END IF;

  INSERT INTO pf_games (club_id, posted_by, starts_at, duration_min, format, spots_needed,
                        rating_min, rating_max, include_unrated, court, note)
  VALUES (p_club, p_user, p_starts_at, p_duration, p_format, p_spots,
          p_rating_min, p_rating_max, coalesce(p_include_unrated, true),
          nullif(trim(p_court), ''), nullif(trim(p_note), ''))
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('ok', true, 'game_id', new_id);
END;
$$;

-- ----------------------------------------------------------------------------
-- Claim a spot. First to tap wins.
--
-- The game row is locked FOR UPDATE, so concurrent claims queue behind each
-- other and each one counts the spots with the previous claim already in.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pf_claim_spot(p_game uuid, p_user uuid, p_via text DEFAULT 'board')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  g pf_games%ROWTYPE;
  taken integer;
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

  IF g.status = 'cancelled' THEN
    RETURN jsonb_build_object('result', 'cancelled');
  END IF;
  IF g.status = 'expired' OR g.starts_at <= now() THEN
    RETURN jsonb_build_object('result', 'past');
  END IF;
  IF g.status = 'full' OR taken >= g.spots_needed THEN
    RETURN jsonb_build_object('result', 'full');
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

-- ----------------------------------------------------------------------------
-- Give a spot back. A full game opens up again.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pf_leave_spot(p_game uuid, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  g pf_games%ROWTYPE;
  was_full boolean;
BEGIN
  SELECT * INTO g FROM pf_games WHERE id = p_game FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pf_game_players WHERE game_id = p_game AND user_id = p_user AND status = 'in') THEN
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

  RETURN jsonb_build_object('result', 'left', 'reopened', was_full);
END;
$$;

-- ----------------------------------------------------------------------------
-- The poster calls the game off.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pf_cancel_game(p_game uuid, p_user uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  g pf_games%ROWTYPE;
BEGIN
  SELECT * INTO g FROM pf_games WHERE id = p_game FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;
  IF g.posted_by <> p_user THEN
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
$$;

-- Past games that never filled. A full game that has been played stays 'full'.
CREATE OR REPLACE FUNCTION pf_expire_games()
RETURNS integer
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH done AS (
    UPDATE pf_games SET status = 'expired', updated_at = now()
     WHERE status = 'open' AND starts_at < now()
    RETURNING 1
  )
  SELECT count(*)::integer FROM done;
$$;

-- Director numbers. Cancelled games are left out of the fill rate: a game the
-- poster called off did not fail to fill.
CREATE OR REPLACE FUNCTION pf_club_stats(p_club uuid, p_since timestamptz)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'posted', count(*),
    'cancelled', count(*) FILTER (WHERE status = 'cancelled'),
    'filled', count(*) FILTER (WHERE filled_at IS NOT NULL AND status <> 'cancelled'),
    'open_now', count(*) FILTER (WHERE status = 'open' AND starts_at > now()),
    'expired', count(*) FILTER (WHERE status = 'expired'),
    'median_fill_minutes', round((percentile_cont(0.5) WITHIN GROUP (
        ORDER BY extract(epoch FROM (filled_at - created_at)) / 60.0
      ) FILTER (WHERE filled_at IS NOT NULL AND status <> 'cancelled'))::numeric, 0),
    'players_joined', (SELECT count(*) FROM pf_game_players gp
                        JOIN pf_games g2 ON g2.id = gp.game_id
                       WHERE g2.club_id = p_club AND g2.created_at >= p_since AND gp.status = 'in')
  )
  FROM pf_games
  WHERE club_id = p_club AND created_at >= p_since;
$$;

-- Service role only for everything that takes a user id as an argument or
-- touches auth.users. pf_in_game is used inside a policy, so sessions need it.
REVOKE ALL ON FUNCTION pf_member_roster(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pf_game_recipients(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pf_post_game(uuid, uuid, timestamptz, integer, text, integer, numeric, numeric, boolean, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pf_claim_spot(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pf_leave_spot(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pf_cancel_game(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pf_expire_games() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pf_club_stats(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION pf_member_roster(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION pf_game_recipients(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION pf_post_game(uuid, uuid, timestamptz, integer, text, integer, numeric, numeric, boolean, text, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION pf_claim_spot(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION pf_leave_spot(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION pf_cancel_game(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION pf_expire_games() TO service_role;
GRANT EXECUTE ON FUNCTION pf_club_stats(uuid, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION pf_in_game(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pf_in_game(uuid) TO authenticated, service_role;
