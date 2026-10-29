-- CourtConnect: the one-time "share CourtConnect" note to a champion.
--
-- Once someone has organized a few games that actually filled and were played,
-- they get one low-pressure email: "Know someone at another club who organizes
-- games? Share CourtConnect with them." One row per person, ever: the row is
-- the claim that stops a second send, and its code tags the shared link so we
-- can see whose shares get opened.

CREATE TABLE IF NOT EXISTS pf_referral_invites (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  club_id        uuid NOT NULL REFERENCES cc_clubs(id) ON DELETE CASCADE,
  code           text NOT NULL UNIQUE,
  games          integer NOT NULL,
  sent_at        timestamptz,
  clicks         integer NOT NULL DEFAULT 0,
  last_click_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pf_referral_invites ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role reads or writes it.

-- Posters with at least p_min games that filled and have been played, who have
-- never been asked. A poster at two clubs is asked once, from the club where
-- they organized the most.
CREATE OR REPLACE FUNCTION pf_referral_candidates(p_min integer)
RETURNS TABLE (user_id uuid, club_id uuid, games integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT DISTINCT ON (t.posted_by) t.posted_by, t.club_id, t.n
    FROM (
      SELECT g.posted_by, g.club_id, count(*)::integer AS n
        FROM pf_games g
       WHERE g.status = 'full' AND g.starts_at < now()
       GROUP BY g.posted_by, g.club_id
      HAVING count(*) >= p_min
    ) t
   WHERE NOT EXISTS (SELECT 1 FROM pf_referral_invites r WHERE r.user_id = t.posted_by)
   ORDER BY t.posted_by, t.n DESC;
$$;

-- Someone opened a shared link.
CREATE OR REPLACE FUNCTION pf_referral_click(p_code text)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE pf_referral_invites
     SET clicks = clicks + 1, last_click_at = now()
   WHERE code = p_code;
$$;

REVOKE ALL ON FUNCTION pf_referral_candidates(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION pf_referral_click(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pf_referral_candidates(integer) TO service_role;
GRANT EXECUTE ON FUNCTION pf_referral_click(text) TO service_role;
