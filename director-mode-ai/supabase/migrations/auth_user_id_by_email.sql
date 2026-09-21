-- Who already has an account at this address?
--
-- Adding a roster player to a club has to be idempotent: run it twice, or run
-- it for someone who signed up last year, and you must reuse their account
-- rather than mint a second one against the same address (auth would reject
-- it, and the first failure would abort a batch halfway through).
--
-- auth.admin.listUsers() is paged and filters in JS, so it answers this
-- question correctly only for the first page — at 200 users it starts saying
-- "no account" about people who have one. This asks Postgres instead.
--
-- LOCKED DOWN. A function that turns an email address into "yes, that person
-- has an account here" is an enumeration oracle, so anon and authenticated are
-- revoked explicitly; only service_role (our server, never a browser) may call
-- it. SECURITY DEFINER is what lets it read auth.users at all.
--
-- Safe to re-run.

CREATE OR REPLACE FUNCTION public.auth_user_id_by_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT u.id
    FROM auth.users u
   WHERE lower(u.email) = lower(trim(p_email))
   ORDER BY u.created_at
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.auth_user_id_by_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_user_id_by_email(text) FROM anon;
REVOKE ALL ON FUNCTION public.auth_user_id_by_email(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_id_by_email(text) TO service_role;
