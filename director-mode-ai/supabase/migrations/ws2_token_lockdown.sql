-- ============================================================================
-- Anon lockdown on the five token-bearing tables (+ matches).
--
-- ws1_isolation_lockdown.sql did this correctly for league_team_rosters and
-- players. These five were missed, and they hold ~380 permanent bearer
-- credentials — score_token, roster_token, signup_token — every one of them
-- listable by anyone holding the public anon key. A token is a credential: it
-- lets the holder enter scores on somebody else's match.
--
-- The tokenized player pages are unaffected: /leagues/*, /quads/*,
-- /tournaments/* all read through the service role, which ignores RLS and
-- grants entirely. The one page that used the anon key — /leagues/[slug]/
-- standings — was moved to the service role and deployed BEFORE this ran.
--
-- Anon also held INSERT/UPDATE/DELETE/TRUNCATE on all six. Nothing writes to
-- them as anon: every score submission goes through a server route that
-- resolves the token first. Those grants are removed too.
-- ============================================================================

-- ---- reads: revoke wholesale, then hand back only what is safe -------------
REVOKE SELECT ON league_clubs           FROM anon;
REVOKE SELECT ON league_division_clubs  FROM anon;
REVOKE SELECT ON league_matchup_lines   FROM anon;
REVOKE SELECT ON quad_matches           FROM anon;
REVOKE SELECT ON tournament_matches     FROM anon;

-- ---- writes: anon never legitimately writes to any of these ---------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON league_clubs          FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON league_division_clubs FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON league_matchup_lines  FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON quad_matches          FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON tournament_matches    FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON league_team_rosters   FROM anon;

-- `matches` additionally had an anon SELECT policy of USING (true) — a full
-- anonymous read of every match in the database, across every club.
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON matches FROM anon;
DROP POLICY IF EXISTS matches_anon_select        ON matches;
DROP POLICY IF EXISTS matches_anon_update_scores ON matches;
