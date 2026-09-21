-- One inbox, two people: the roster row that matches the NAME wins.
--
-- A club roster is full of households. Darrin's address carries both his row
-- and his son Gavin's; Shannon Koffman's carries his kid Sutton's. Linking
-- those rows to an account by email (pf_vault_user_link.sql step 2) attached
-- a child's roster entry — name, rating, everything — to the parent's login,
-- and once the roster started preferring the club's name for a person, the
-- club's CourtConnect page started calling Shannon "Sutton D Koffman".
--
-- So when several of a director's rows resolve to one account, the one whose
-- name matches the account is taken first. A corrected name still works:
-- Walden Browne's row matches no account name (his login says Lawrence), so
-- the link decides, which is what it is for. Only the three ORDER BYs change.
--
-- Safe to re-run.

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
    -- Where the club says to write to them, then where they log in. Lowercased
    -- because it is both the send address and the key the unsubscribe list is
    -- checked against, and a director who types an address in capitals must
    -- not thereby slip past somebody's opt-out.
    lower(coalesce(nullif(trim(vl.email), ''), u.email::text)) AS email,
    -- The club's own name for this person first, the same way the address and
    -- the rating already work. A director who retypes a name in PlayerVault is
    -- telling us what to call them: Darrin changed "Lawrence Browne" to
    -- "Walden" (2026-09-21) and every CourtConnect surface went on saying
    -- Lawrence, because the account's profile name was winning. The profile
    -- name stays as the fallback for members the club has no roster row for.
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
  JOIN cc_clubs c ON c.id = m.club_id
  JOIN auth.users u ON u.id = m.user_id
  LEFT JOIN profiles p ON p.id = m.user_id
  LEFT JOIN pf_member_prefs pr ON pr.club_id = m.club_id AND pr.user_id = m.user_id
  -- The club's record of this person: the linked row first, an unlinked row
  -- whose email still matches second. This one carries the contact details;
  -- the rating laterals below repeat the same test because a director can
  -- hold more than one row for a person and only one of them may be rated.
  LEFT JOIN LATERAL (
    SELECT vp.email, vp.full_name
      FROM cc_vault_players vp
     WHERE vp.director_id = c.owner_id
       AND (vp.user_id = m.user_id
            OR (vp.user_id IS NULL AND u.email IS NOT NULL
                AND lower(trim(vp.email)) = lower(u.email)))
     ORDER BY (lower(trim(vp.full_name)) = lower(trim(coalesce(
                 nullif(trim(p.full_name), ''),
                 nullif(trim(u.raw_user_meta_data->>'full_name'), ''), '')))) DESC,
              (vp.user_id = m.user_id) DESC, vp.updated_at DESC NULLS LAST
     LIMIT 1
  ) vl ON true
  LEFT JOIN LATERAL (
    SELECT vp.usta_rating FROM cc_vault_players vp
     WHERE vp.director_id = c.owner_id
       AND (vp.user_id = m.user_id
            OR (vp.user_id IS NULL AND u.email IS NOT NULL
                AND lower(trim(vp.email)) = lower(u.email)))
       AND vp.usta_rating IS NOT NULL
     ORDER BY (lower(trim(vp.full_name)) = lower(trim(coalesce(
                 nullif(trim(p.full_name), ''),
                 nullif(trim(u.raw_user_meta_data->>'full_name'), ''), '')))) DESC,
              (vp.user_id = m.user_id) DESC, vp.updated_at DESC NULLS LAST
     LIMIT 1
  ) v ON true
  -- master_players is still keyed by email, so ask it about BOTH addresses:
  -- the one the club uses and the one they log in with. A rating filed under
  -- either is theirs.
  LEFT JOIN LATERAL (
    SELECT mpl.ntrp, mpl.ntrp_source FROM master_players mpl
     WHERE mpl.email_normalized IN (lower(u.email), lower(trim(vl.email)))
       AND mpl.ntrp IS NOT NULL
     ORDER BY mpl.ntrp_updated_at DESC NULLS LAST
     LIMIT 1
  ) mp ON true
  LEFT JOIN LATERAL (
    SELECT vp.dupr_singles, vp.dupr_doubles FROM cc_vault_players vp
     WHERE vp.director_id = c.owner_id
       AND (vp.user_id = m.user_id
            OR (vp.user_id IS NULL AND u.email IS NOT NULL
                AND lower(trim(vp.email)) = lower(u.email)))
       AND (vp.dupr_singles IS NOT NULL OR vp.dupr_doubles IS NOT NULL)
     ORDER BY (lower(trim(vp.full_name)) = lower(trim(coalesce(
                 nullif(trim(p.full_name), ''),
                 nullif(trim(u.raw_user_meta_data->>'full_name'), ''), '')))) DESC,
              (vp.user_id = m.user_id) DESC, vp.updated_at DESC NULLS LAST
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
