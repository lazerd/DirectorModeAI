-- CourtConnect: a game can be for men only or women only (2026-09-28).
--
-- Asked for by Darrin after Walden's 3.0–3.5 doubles: a men's game was
-- emailed to the whole level, women included. NULL = anyone, which is every
-- game posted before this.
--
-- Gender comes from PlayerVault (cc_vault_players.gender, 'male'/'female').
-- Someone with no gender on file is left out of a men's or women's game, the
-- same way an unrated member is left out of a level range unless asked for.

ALTER TABLE pf_games ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE pf_games DROP CONSTRAINT IF EXISTS pf_games_gender_check;
ALTER TABLE pf_games ADD CONSTRAINT pf_games_gender_check
  CHECK (gender IS NULL OR gender IN ('male', 'female'));

CREATE OR REPLACE FUNCTION public.pf_game_recipients(p_game uuid, p_limit integer DEFAULT 50)
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
    AND (
      g.gender IS NULL
      OR EXISTS (SELECT 1 FROM cc_vault_players v
                  WHERE v.id = r.person_id AND lower(v.gender) = g.gender)
    )
  ORDER BY
    (r.ntrp IS NULL),
    abs(coalesce(r.ntrp, 0) - (coalesce(g.rating_min, 1.0) + coalesce(g.rating_max, 7.0)) / 2),
    random()
  LIMIT greatest(p_limit, 0);
$function$;
