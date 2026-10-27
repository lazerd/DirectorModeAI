-- Editing a PlayerVault email must never cut the person off from their login.
--
-- pf_vault_user_link.sql made cc_vault_players.user_id the link between a
-- roster row (the PERSON) and their account. Rows linked since then survive
-- any number of email corrections. But a row that was never stamped -- seated
-- after that backfill ran, or imported later -- still reaches its account only
-- through the email fallback (row unlinked, address matches, account has no
-- linked row). Correct that address and the fallback stops matching: the
-- person shows up twice in PlayerVault (a roster row with Add/Invite, which
-- would mint a SECOND account, and a ghost member row with the old address),
-- and CourtConnect loses their rating. Ben Schneider at Sleepy Hollow is in
-- exactly that state today.
--
-- Two parts:
--   1. Stamp those rows now, with the same narrow rule the roster uses.
--   2. A trigger that does the same at the moment an unlinked row's email is
--      edited, using the OLD address -- so the edit keeps the person whole no
--      matter which screen or import made it.
--
-- Neither ever touches auth.users: the login email stays what it was. A
-- household inbox (Pat and Sam Kim on one address) is left alone -- an account
-- that already has a linked row is never handed a second one.
--
-- Safe to re-run.

-- 1. Backfill: an unlinked row whose email is a seated account's login, in a
--    club where that account has no linked row, and where that address picks
--    out ONE row (the name-matching one, else the only one).
WITH cand AS (
  SELECT v.id AS vault_id, v.club_id, m.user_id,
         lower(trim(v.full_name)) = lower(trim(coalesce(
           nullif(trim(p.full_name), ''),
           nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
           nullif(trim(u.raw_user_meta_data->>'name'), ''), ''))) AS name_matches
    FROM cc_vault_players v
    JOIN cc_club_members m ON m.club_id = v.club_id
    JOIN auth.users u      ON u.id = m.user_id
    LEFT JOIN profiles p   ON p.id = m.user_id
   WHERE v.user_id IS NULL
     AND v.club_id IS NOT NULL
     AND nullif(trim(v.email), '') IS NOT NULL
     AND u.email IS NOT NULL
     AND lower(trim(v.email)) = lower(u.email)
     AND NOT EXISTS (
       SELECT 1 FROM cc_vault_players lk
        WHERE lk.club_id = v.club_id AND lk.user_id = m.user_id
     )
), ranked AS (
  SELECT vault_id, user_id,
         count(*) OVER (PARTITION BY club_id, user_id)                          AS rows_for_user,
         count(*) FILTER (WHERE name_matches) OVER (PARTITION BY club_id, user_id) AS named_for_user,
         name_matches
    FROM cand
)
UPDATE cc_vault_players vp
   SET user_id = r.user_id
  FROM ranked r
 WHERE vp.id = r.vault_id
   AND vp.user_id IS NULL
   AND (r.rows_for_user = 1 OR (r.name_matches AND r.named_for_user = 1));

-- 2. Keep the link through an email edit.
CREATE OR REPLACE FUNCTION public.cc_vault_keep_login_on_email_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user uuid;
  v_rows int;
BEGIN
  IF NEW.user_id IS NOT NULL
     OR NEW.club_id IS NULL
     OR nullif(trim(OLD.email), '') IS NULL
     OR lower(trim(coalesce(NEW.email, ''))) = lower(trim(OLD.email)) THEN
    RETURN NEW;
  END IF;

  -- The seated account the OLD address belonged to, if it has no row yet.
  SELECT m.user_id INTO v_user
    FROM cc_club_members m
    JOIN auth.users u ON u.id = m.user_id
   WHERE m.club_id = NEW.club_id
     AND lower(u.email) = lower(trim(OLD.email))
     AND NOT EXISTS (
       SELECT 1 FROM cc_vault_players lk
        WHERE lk.club_id = NEW.club_id AND lk.user_id = m.user_id
     )
   LIMIT 1;
  IF v_user IS NULL THEN
    RETURN NEW;
  END IF;

  -- A shared inbox: other unlinked rows on that address mean we cannot tell
  -- which person the login is. Leave it for a human.
  SELECT count(*) INTO v_rows
    FROM cc_vault_players o
   WHERE o.club_id = NEW.club_id
     AND o.user_id IS NULL
     AND o.id <> NEW.id
     AND lower(trim(o.email)) = lower(trim(OLD.email));
  IF v_rows > 0 THEN
    RETURN NEW;
  END IF;

  NEW.user_id := v_user;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.cc_vault_keep_login_on_email_edit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cc_vault_keep_login_on_email_edit ON cc_vault_players;
CREATE TRIGGER cc_vault_keep_login_on_email_edit
  BEFORE UPDATE OF email ON cc_vault_players
  FOR EACH ROW
  EXECUTE FUNCTION public.cc_vault_keep_login_on_email_edit();
