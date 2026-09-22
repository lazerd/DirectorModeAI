-- CourtConnect reaches PEOPLE, not accounts.
--
-- Darrin, 2026-09-22: "everyone in playervault should be automatically part of
-- court connect unless they opt out of it. opt in is stupid. the two programs
-- should seemlessly interact with one another and be totally in sync."
--
-- They could not be, because CourtConnect's roster started at cc_club_members
-- and joined auth.users. A login credential was the unit of identity for a
-- person at a club, which is a bad fit for the thing it was modelling:
--
--   * 79 of Sleepy Hollow's 92 addresses had no account, so CourtConnect could
--     not see them. The workaround was to MANUFACTURE accounts -- 36 of them on
--     2026-09-21 -- passwordless logins created for people who will never sign
--     in, purely so they could receive an email. CourtConnect does not even
--     need the account: every invitation carries a per-person token link and
--     "I'm in" works with no session.
--   * Couples share an inbox. One account cannot be two players, so Ryan
--     Alexander and Vi Le, and two other pairs, could not both exist.
--   * Joshua Marke is the mirror image -- an account with no roster row --
--     counted as a member with no level and nowhere to put one.
--
-- So the roster row IS the person. cc_vault_players.id is the identity;
-- an account is an optional attachment meaning "this person can also sign in".
-- Being in a club's PlayerVault is being in its CourtConnect, and
-- notify_games (already default true) is the opt-out.
--
-- Safe to re-run.

-- 1. Nobody in the club is missing from the roster.
--
-- Staff were seated straight into cc_club_members and never appeared in
-- PlayerVault, so there was no row to hold their level. One row each, linked
-- to their account, so the two lists are genuinely one list from here on.
INSERT INTO cc_vault_players (club_id, director_id, user_id, full_name, email, membership_status)
SELECT m.club_id,
       c.owner_id,
       m.user_id,
       coalesce(
         nullif(trim(p.full_name), ''),
         nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
         nullif(trim(u.raw_user_meta_data->>'name'), ''),
         split_part(u.email, '@', 1)
       ),
       u.email,
       'active'
  FROM cc_club_members m
  JOIN cc_clubs c   ON c.id = m.club_id
  JOIN auth.users u ON u.id = m.user_id
  LEFT JOIN profiles p ON p.id = m.user_id
 WHERE m.role <> 'maintenance'
   AND NOT EXISTS (
     SELECT 1 FROM cc_vault_players v
      WHERE v.club_id = m.club_id
        AND (v.user_id = m.user_id
             OR (u.email IS NOT NULL AND lower(trim(v.email)) = lower(u.email)))
   );

-- Link any row that matches an account by address and is not yet claimed, so
-- step 3 can carry existing CourtConnect history onto the right person.
UPDATE cc_vault_players v
   SET user_id = m.user_id
  FROM cc_club_members m
  JOIN auth.users u ON u.id = m.user_id
 WHERE v.club_id = m.club_id
   AND v.user_id IS NULL
   AND u.email IS NOT NULL
   AND lower(trim(v.email)) = lower(u.email)
   AND NOT EXISTS (
     SELECT 1 FROM cc_vault_players other
      WHERE other.club_id = v.club_id AND other.user_id = m.user_id
   );

-- 2. The person key on everything CourtConnect remembers.
ALTER TABLE pf_member_prefs ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES cc_vault_players(id) ON DELETE CASCADE;
ALTER TABLE pf_game_players ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES cc_vault_players(id) ON DELETE CASCADE;
ALTER TABLE pf_links        ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES cc_vault_players(id) ON DELETE CASCADE;

-- 3. Carry the history over. Seven games, five joins, eighteen links and
--    twenty-four preference rows is the entire history -- which is exactly why
--    this is being done now rather than after a season of play.
UPDATE pf_member_prefs t SET person_id = v.id
  FROM cc_vault_players v
 WHERE t.person_id IS NULL AND v.club_id = t.club_id AND v.user_id = t.user_id;

UPDATE pf_game_players t SET person_id = v.id
  FROM cc_vault_players v
 WHERE t.person_id IS NULL AND v.club_id = t.club_id AND v.user_id = t.user_id;

UPDATE pf_links t SET person_id = v.id
  FROM cc_vault_players v
 WHERE t.person_id IS NULL AND v.club_id = t.club_id AND v.user_id = t.user_id;

-- An account is optional from here, so the account column must be -- and the
-- keys that were built on it have to move to the person first. A preference
-- row keyed (club, account) cannot describe somebody who has no account.
ALTER TABLE pf_member_prefs DROP CONSTRAINT IF EXISTS pf_member_prefs_pkey;
ALTER TABLE pf_game_players DROP CONSTRAINT IF EXISTS pf_game_players_game_id_user_id_key;
ALTER TABLE pf_links        DROP CONSTRAINT IF EXISTS pf_links_game_id_user_id_key;

ALTER TABLE pf_member_prefs ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE pf_game_players ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE pf_links        ALTER COLUMN user_id DROP NOT NULL;

-- One preference row per person per club, and one seat per person per game.
DELETE FROM pf_member_prefs WHERE person_id IS NULL;
ALTER TABLE pf_member_prefs ALTER COLUMN person_id SET NOT NULL;
ALTER TABLE pf_member_prefs ADD PRIMARY KEY (club_id, person_id);
CREATE UNIQUE INDEX IF NOT EXISTS pf_game_players_person_idx ON pf_game_players (game_id, person_id);
CREATE UNIQUE INDEX IF NOT EXISTS pf_links_game_person_idx ON pf_links (game_id, person_id);

-- 4. The roster IS the club's PlayerVault.
--
-- Starts at cc_vault_players and LEFT JOINs the account, which is the whole
-- change: a person with no login is a full member of this list, with a level,
-- an address, a preference row and a stop link. `role` comes from the account
-- when there is one and is plain 'member' otherwise -- somebody the club put
-- on its roster is a member of it.
--
-- p_user still filters by ACCOUNT, because its callers hold a session; p_person
-- filters by the person, for the tokenized pages that have no session at all.
DROP FUNCTION IF EXISTS public.pf_member_roster(uuid, uuid);

CREATE FUNCTION public.pf_member_roster(
  p_club uuid,
  p_user uuid DEFAULT NULL::uuid,
  p_person uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
  person_id uuid,
  user_id uuid,
  email text,
  full_name text,
  role text,
  ntrp numeric,
  ntrp_source text,
  notify_games boolean,
  share_phone boolean,
  phone text,
  stop_token text,
  dupr_singles numeric,
  dupr_doubles numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    vp.id AS person_id,
    vp.user_id,
    lower(coalesce(nullif(trim(vp.email), ''), u.email::text)) AS email,
    coalesce(
      nullif(trim(vp.full_name), ''),
      nullif(trim(p.full_name), ''),
      nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(u.raw_user_meta_data->>'name'), '')
    ) AS full_name,
    coalesce(m.role, 'member') AS role,
    coalesce(vp.usta_rating, mpl.ntrp) AS ntrp,
    CASE WHEN vp.usta_rating IS NOT NULL THEN 'club'
         WHEN mpl.ntrp IS NOT NULL THEN coalesce(mpl.ntrp_source, 'self') END AS ntrp_source,
    -- The opt-out. Absent means in, which is the point.
    coalesce(pr.notify_games, true) AS notify_games,
    coalesce(pr.share_phone, false) AS share_phone,
    coalesce(pr.phone, vp.phone) AS phone,
    pr.stop_token,
    coalesce(vp.dupr_singles, md.dupr_singles) AS dupr_singles,
    coalesce(vp.dupr_doubles, md.dupr_doubles) AS dupr_doubles
  FROM cc_vault_players vp
  LEFT JOIN auth.users u ON u.id = vp.user_id
  LEFT JOIN profiles p   ON p.id = vp.user_id
  LEFT JOIN cc_club_members m ON m.club_id = vp.club_id AND m.user_id = vp.user_id
  LEFT JOIN pf_member_prefs pr ON pr.club_id = vp.club_id AND pr.person_id = vp.id
  LEFT JOIN LATERAL (
    SELECT x.ntrp, x.ntrp_source FROM master_players x
     WHERE x.email_normalized = lower(coalesce(nullif(trim(vp.email), ''), u.email::text))
       AND x.ntrp IS NOT NULL
     ORDER BY x.ntrp_updated_at DESC NULLS LAST
     LIMIT 1
  ) mpl ON true
  LEFT JOIN LATERAL (
    SELECT x.dupr_singles, x.dupr_doubles FROM master_players x
     WHERE x.email_normalized = lower(coalesce(nullif(trim(vp.email), ''), u.email::text))
       AND (x.dupr_singles IS NOT NULL OR x.dupr_doubles IS NOT NULL)
     ORDER BY x.dupr_updated_at DESC NULLS LAST
     LIMIT 1
  ) md ON true
  WHERE vp.club_id = p_club
    AND coalesce(m.role, 'member') <> 'maintenance'
    AND coalesce(vp.membership_status, 'active') <> 'inactive'
    AND (p_user IS NULL OR vp.user_id = p_user)
    AND (p_person IS NULL OR vp.id = p_person);
$function$;

-- 5. Who a game should reach, by person.
DROP FUNCTION IF EXISTS public.pf_game_recipients(uuid, integer);

CREATE FUNCTION public.pf_game_recipients(p_game uuid, p_limit integer DEFAULT 50)
RETURNS TABLE(person_id uuid, user_id uuid, email text, full_name text, ntrp numeric, stop_token text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT r.person_id, r.user_id, r.email, r.full_name, r.ntrp, r.stop_token
  FROM pf_games g
  CROSS JOIN LATERAL pf_member_roster(g.club_id) r
  WHERE g.id = p_game
    AND r.person_id <> coalesce(
          (SELECT v.id FROM cc_vault_players v
            WHERE v.club_id = g.club_id AND v.user_id = g.posted_by LIMIT 1),
          '00000000-0000-0000-0000-000000000000'::uuid)
    AND r.email IS NOT NULL
    AND r.notify_games
    AND NOT EXISTS (
      SELECT 1 FROM pf_game_players gp
       WHERE gp.game_id = g.id AND gp.person_id = r.person_id AND gp.status IN ('in', 'wait')
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
$function$;

REVOKE ALL ON FUNCTION pf_member_roster(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pf_member_roster(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION pf_game_recipients(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pf_game_recipients(uuid, integer) TO service_role;
