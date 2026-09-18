-- CourtConnect's roster carries DUPR too.
--
-- pf_member_roster is the one read that answers "who is at this club and what
-- level are they" (see partner_finder.sql). It already folds the club's
-- PlayerVault rating over the person's own NTRP; this adds the same two-step
-- for DUPR, so a pickleball club whose members have real DUPR ratings shows
-- them instead of a self-selected tier name.
--
-- The MATCHING key does not change. levelFits() still compares `ntrp`, games
-- still store rating_min/rating_max on that one axis, and a DUPR rating is
-- folded onto it by lib/levels/dupr.ts (duprToRating) rather than becoming a
-- second, invisible way for a game to fit one member and not another.
--
-- The return TYPE changes, so this is a drop and recreate rather than a
-- CREATE OR REPLACE — one statement file, one implicit transaction.
-- pf_game_recipients selects from this by NAME and is unaffected by the two
-- new columns on the end.
--
-- Safe to re-run.

DROP FUNCTION IF EXISTS public.pf_member_roster(uuid, uuid);

CREATE FUNCTION public.pf_member_roster(p_club uuid, p_user uuid DEFAULT NULL::uuid)
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
    pr.stop_token,
    coalesce(vd.dupr_singles, md.dupr_singles) AS dupr_singles,
    coalesce(vd.dupr_doubles, md.dupr_doubles) AS dupr_doubles
  FROM cc_club_members m
  JOIN cc_clubs c ON c.id = m.club_id
  JOIN auth.users u ON u.id = m.user_id
  LEFT JOIN profiles p ON p.id = m.user_id
  LEFT JOIN pf_member_prefs pr ON pr.club_id = m.club_id AND pr.user_id = m.user_id
  -- The NTRP laterals are untouched from partner_finder.sql. The DUPR ones are
  -- their own, rather than widening these: a roster row with a DUPR and no
  -- NTRP must not become the row that answers the NTRP question, which is
  -- still what CourtConnect matches on.
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
  LEFT JOIN LATERAL (
    SELECT vp.dupr_singles, vp.dupr_doubles FROM cc_vault_players vp
     WHERE vp.director_id = c.owner_id
       AND u.email IS NOT NULL
       AND lower(trim(vp.email)) = lower(u.email)
       AND (vp.dupr_singles IS NOT NULL OR vp.dupr_doubles IS NOT NULL)
     ORDER BY vp.updated_at DESC NULLS LAST
     LIMIT 1
  ) vd ON true
  LEFT JOIN LATERAL (
    SELECT mpl.dupr_singles, mpl.dupr_doubles FROM master_players mpl
     WHERE u.email IS NOT NULL
       AND mpl.email_normalized = lower(u.email)
       AND (mpl.dupr_singles IS NOT NULL OR mpl.dupr_doubles IS NOT NULL)
     ORDER BY mpl.dupr_updated_at DESC NULLS LAST
     LIMIT 1
  ) md ON true
  WHERE m.club_id = p_club
    AND m.role <> 'maintenance'
    AND (p_user IS NULL OR m.user_id = p_user);
$function$;
