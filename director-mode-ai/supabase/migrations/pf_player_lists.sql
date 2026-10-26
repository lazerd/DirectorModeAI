-- CourtConnect: club player lists (2026-10-26).
--
-- Asked for by Darrin for Becca Moltyaner, a member who wanted pickleball:
-- "create a court connect 'list' with all the former pickleball players so she
-- can setup games with ease ... make sure she can check a box that sends a
-- court connect to anyone on our pickleball player list!"
--
-- A list is a named set of PlayerVault people at one club (members only, the
-- same as everything else CourtConnect emails). A game posted "to a list"
-- emails the people on it instead of the club's level-matched roster. The
-- level filter is skipped for a list game: a pickleball list is not rated on
-- the tennis ladder, and the list IS the filter. Gender still applies.
--
-- `sport` rides on both so a pickleball game says "pickleball doubles" in the
-- email and on the board instead of a bare "doubles" that reads as tennis.

CREATE TABLE IF NOT EXISTS pf_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  name text NOT NULL,
  sport text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_id, name)
);

CREATE TABLE IF NOT EXISTS pf_list_members (
  list_id uuid NOT NULL REFERENCES pf_lists(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES cc_vault_players(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, person_id)
);

-- Service role only, like pf_links.
ALTER TABLE pf_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_list_members ENABLE ROW LEVEL SECURITY;

ALTER TABLE pf_games ADD COLUMN IF NOT EXISTS list_id uuid REFERENCES pf_lists(id) ON DELETE SET NULL;
ALTER TABLE pf_games ADD COLUMN IF NOT EXISTS sport text;

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
      g.list_id IS NULL
      OR EXISTS (SELECT 1 FROM pf_list_members lm
                  WHERE lm.list_id = g.list_id AND lm.person_id = r.person_id)
    )
    AND (
      g.list_id IS NOT NULL
      OR (g.rating_min IS NULL AND g.rating_max IS NULL)
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
