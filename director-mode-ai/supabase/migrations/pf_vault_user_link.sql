-- PlayerVault rows point at an ACCOUNT, not at an email address.
--
-- CourtConnect folds a club's PlayerVault over the member's account to answer
-- "what level is this person and where do we write to them". It did that fold
-- by string-matching the email: cc_vault_players.email = auth.users.email.
--
-- So the moment a director corrected somebody's email in PlayerVault, the
-- person came apart into two halves. Darrin fixed Peter Schwaikert's address
-- (the club had his wife's) and Dimitry Lerner's on 2026-09-21; both instantly
-- went from 3.0 and 3.5 to "no NTRP" on the CourtConnect roster, and both were
-- still going to be emailed at the old address. Nothing told him: the club
-- record said 3.0, the game preview said unrated, and the only visible symptom
-- was a level filter quietly letting the wrong people in and keeping the right
-- ones out.
--
-- An email is how a person is FOUND the first time. It is the wrong thing to
-- keep identity in, because it is the field most likely to be corrected.
--
-- This adds cc_vault_players.user_id -- a real foreign key to the account --
-- and makes the roster prefer it. Once a row is linked, the director can
-- retype the email as often as they like and the rating, the history and the
-- person stay together. The email match stays as the fallback for rows that
-- were never linked, which is how a brand-new vault import still finds its
-- people.
--
-- The contact address then comes from the VAULT when there is one, falling
-- back to the login email. That is the whole point of the edit: a director who
-- fixes an address in the club's own records is telling us where to write.
--
-- Safe to re-run.

-- 1. The link itself.
ALTER TABLE cc_vault_players
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cc_vault_players_user_idx
  ON cc_vault_players (director_id, user_id);

-- 2. Backfill by the email that still matches. This is the same rule the old
--    fold used, so it links every row that works today and changes nothing
--    about who is matched to whom.
UPDATE cc_vault_players vp
   SET user_id = u.id
  FROM auth.users u
 WHERE vp.user_id IS NULL
   AND vp.email IS NOT NULL
   AND lower(trim(vp.email)) = lower(u.email);

-- 3. Backfill the rows whose email was ALREADY edited away -- the Peters and
--    Dimitrys this migration exists for. Deliberately narrow: the person must
--    be a member of a club this director owns, the trimmed name must match
--    exactly, and it must match exactly ONE member and ONE vault row. Anything
--    ambiguous is left unlinked for a human, because guessing here would
--    attach one member's rating to another member's name.
WITH candidate AS (
  SELECT vp.id AS vault_id,
         m.user_id,
         count(*) OVER (PARTITION BY vp.id)            AS members_for_row,
         count(*) OVER (PARTITION BY c.id, m.user_id)  AS rows_for_member
    FROM cc_vault_players vp
    JOIN cc_clubs c        ON c.owner_id = vp.director_id
    JOIN cc_club_members m ON m.club_id = c.id
    JOIN auth.users u      ON u.id = m.user_id
    LEFT JOIN profiles p   ON p.id = m.user_id
   WHERE vp.user_id IS NULL
     AND nullif(trim(vp.full_name), '') IS NOT NULL
     AND lower(trim(vp.full_name)) = lower(trim(coalesce(
           nullif(trim(p.full_name), ''),
           nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
           nullif(trim(u.raw_user_meta_data->>'name'), ''),
           '')))
     AND NOT EXISTS (
       SELECT 1 FROM cc_vault_players other
        WHERE other.director_id = vp.director_id
          AND other.user_id = m.user_id
     )
)
UPDATE cc_vault_players vp
   SET user_id = candidate.user_id
  FROM candidate
 WHERE vp.id = candidate.vault_id
   AND candidate.members_for_row = 1
   AND candidate.rows_for_member = 1;

-- 4. The roster reads the link.
--
-- Return type is unchanged, so this is a replace. pf_game_recipients selects
-- from it by name and needs no edit.
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
    coalesce(
      nullif(trim(p.full_name), ''),
      nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(u.raw_user_meta_data->>'name'), ''),
      nullif(trim(vl.full_name), '')
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
     ORDER BY (vp.user_id = m.user_id) DESC, vp.updated_at DESC NULLS LAST
     LIMIT 1
  ) vl ON true
  LEFT JOIN LATERAL (
    SELECT vp.usta_rating FROM cc_vault_players vp
     WHERE vp.director_id = c.owner_id
       AND (vp.user_id = m.user_id
            OR (vp.user_id IS NULL AND u.email IS NOT NULL
                AND lower(trim(vp.email)) = lower(u.email)))
       AND vp.usta_rating IS NOT NULL
     ORDER BY (vp.user_id = m.user_id) DESC, vp.updated_at DESC NULLS LAST
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
     ORDER BY (vp.user_id = m.user_id) DESC, vp.updated_at DESC NULLS LAST
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
