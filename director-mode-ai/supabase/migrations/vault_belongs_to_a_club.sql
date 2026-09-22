-- PlayerVault belongs to a CLUB, not to a director.
--
-- cc_vault_players was scoped by director_id, and everything downstream asked
-- "who owns this club?" and then read that person's whole vault. One director,
-- one club, no problem -- until a director has two.
--
-- Darrin owns Sleepy Hollow and, for the Rossmoor pitch, Rossmoor Tennis and
-- Rossmoor Pickleball. On 2026-09-22 that meant:
--
--   * Rossmoor Tennis Club's CourtConnect roster was reading SLEEPY HOLLOW's
--     PlayerVault -- Shannon Koffman and Walden Browne, with their Sleepy
--     Hollow ratings -- while Rossmoor's own 60-row vault, which lives under a
--     demo director account, was invisible to it.
--   * clubAutoJoin looked up a vault row, took its director, and seated the
--     person in EVERY club that director owns. Two real Sleepy Hollow members
--     were sitting in both Rossmoor clubs, in line to be emailed about games at
--     a club they have never heard of.
--
-- Darrin, 2026-09-22: "PlayerVault should be absolutely separated out by club
-- ...even if i own three clubs the player vaults should not overlap."
--
-- director_id stays: it still records who entered the row, and the demo vaults
-- are entered by demo accounts that own nothing. It is just no longer the thing
-- that decides which club a person belongs to.
--
-- Safe to re-run.

-- 1. The column.
ALTER TABLE cc_vault_players
  ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES cc_clubs(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS cc_vault_players_club_idx
  ON cc_vault_players (club_id);

-- 2. Backfill.
--
-- The club the entering director owns -- their first, when they own several,
-- which is the same club every other lookup in the app already resolves to. A
-- director who owns nothing (the three demo accounts) gets the club they staff.
-- Both are unambiguous for every row that exists today; anything that resolves
-- to nothing is left null rather than guessed at.
UPDATE cc_vault_players v
   SET club_id = x.club_id
  FROM (
    SELECT v2.id,
           coalesce(
             (SELECT c.id FROM cc_clubs c
               WHERE c.owner_id = v2.director_id
               ORDER BY c.created_at LIMIT 1),
             (SELECT m.club_id FROM cc_club_members m
               WHERE m.user_id = v2.director_id
                 AND m.role IN ('owner', 'director')
               ORDER BY m.created_at LIMIT 1)
           ) AS club_id
      FROM cc_vault_players v2
  ) x
 WHERE v.id = x.id
   AND v.club_id IS NULL;

-- 3. The roster reads the club's vault, not the owner's.
--
-- This is the one line that was sending Rossmoor to Sleepy Hollow's roster.
-- Everything else about this function is as it was left by
-- pf_vault_user_link.sql.
CREATE OR REPLACE FUNCTION public.pf_member_roster(p_club uuid, p_user uuid DEFAULT NULL::uuid)
RETURNS TABLE(
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
    m.user_id,
    lower(coalesce(nullif(trim(vl.email), ''), u.email::text)) AS email,
    coalesce(
      nullif(trim(vl.full_name), ''),
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
    pr.stop_token,
    coalesce(vd.dupr_singles, md.dupr_singles) AS dupr_singles,
    coalesce(vd.dupr_doubles, md.dupr_doubles) AS dupr_doubles
  FROM cc_club_members m
  JOIN auth.users u ON u.id = m.user_id
  LEFT JOIN profiles p ON p.id = m.user_id
  LEFT JOIN pf_member_prefs pr ON pr.club_id = m.club_id AND pr.user_id = m.user_id
  LEFT JOIN LATERAL (
    SELECT vp.email, vp.full_name
      FROM cc_vault_players vp
     WHERE vp.club_id = m.club_id
       AND (vp.user_id = m.user_id
            OR (vp.user_id IS NULL AND u.email IS NOT NULL
                AND lower(trim(vp.email)) = lower(u.email)
                AND NOT EXISTS (
                  SELECT 1 FROM cc_vault_players lk
                   WHERE lk.club_id = m.club_id AND lk.user_id = m.user_id
                )))
     ORDER BY (vp.user_id = m.user_id) DESC NULLS LAST,
              (lower(trim(vp.full_name)) = lower(trim(coalesce(
                 nullif(trim(p.full_name), ''),
                 nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
                 nullif(trim(u.raw_user_meta_data->>'name'), ''), '')))) DESC,
              vp.updated_at DESC NULLS LAST
     LIMIT 1
  ) vl ON true
  LEFT JOIN LATERAL (
    SELECT vp.usta_rating FROM cc_vault_players vp
     WHERE vp.club_id = m.club_id
       AND (vp.user_id = m.user_id
            OR (vp.user_id IS NULL AND u.email IS NOT NULL
                AND lower(trim(vp.email)) = lower(u.email)
                AND NOT EXISTS (
                  SELECT 1 FROM cc_vault_players lk
                   WHERE lk.club_id = m.club_id AND lk.user_id = m.user_id
                )))
       AND vp.usta_rating IS NOT NULL
     ORDER BY (vp.user_id = m.user_id) DESC NULLS LAST,
              (lower(trim(vp.full_name)) = lower(trim(coalesce(
                 nullif(trim(p.full_name), ''),
                 nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
                 nullif(trim(u.raw_user_meta_data->>'name'), ''), '')))) DESC,
              vp.updated_at DESC NULLS LAST
     LIMIT 1
  ) v ON true
  LEFT JOIN LATERAL (
    SELECT mpl.ntrp, mpl.ntrp_source FROM master_players mpl
     WHERE mpl.email_normalized IN (lower(u.email), lower(trim(vl.email)))
       AND mpl.ntrp IS NOT NULL
     ORDER BY mpl.ntrp_updated_at DESC NULLS LAST
     LIMIT 1
  ) mp ON true
  LEFT JOIN LATERAL (
    SELECT vp.dupr_singles, vp.dupr_doubles FROM cc_vault_players vp
     WHERE vp.club_id = m.club_id
       AND (vp.user_id = m.user_id
            OR (vp.user_id IS NULL AND u.email IS NOT NULL
                AND lower(trim(vp.email)) = lower(u.email)
                AND NOT EXISTS (
                  SELECT 1 FROM cc_vault_players lk
                   WHERE lk.club_id = m.club_id AND lk.user_id = m.user_id
                )))
       AND (vp.dupr_singles IS NOT NULL OR vp.dupr_doubles IS NOT NULL)
     ORDER BY (vp.user_id = m.user_id) DESC NULLS LAST,
              (lower(trim(vp.full_name)) = lower(trim(coalesce(
                 nullif(trim(p.full_name), ''),
                 nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
                 nullif(trim(u.raw_user_meta_data->>'name'), ''), '')))) DESC,
              vp.updated_at DESC NULLS LAST
     LIMIT 1
  ) vd ON true
  LEFT JOIN LATERAL (
    SELECT mpl.dupr_singles, mpl.dupr_doubles FROM master_players mpl
     WHERE mpl.email_normalized IN (lower(u.email), lower(trim(vl.email)))
       AND (mpl.dupr_singles IS NOT NULL OR mpl.dupr_doubles IS NOT NULL)
     ORDER BY mpl.dupr_updated_at DESC NULLS LAST
     LIMIT 1
  ) md ON true
  WHERE m.club_id = p_club
    AND m.role <> 'maintenance'
    AND (p_user IS NULL OR m.user_id = p_user);
$function$;

REVOKE ALL ON FUNCTION pf_member_roster(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pf_member_roster(uuid, uuid) TO service_role;
