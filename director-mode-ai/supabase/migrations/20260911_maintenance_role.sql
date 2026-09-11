-- =====================================================================
-- The Maintenance role (MaintenanceMode).
--
-- A maintenance crew member gets their own login but must see ONLY
-- MaintenanceMode — never the member roster, events, leagues, lesson notes
-- or anything else carrying member contact details.
--
--   1. Allow 'maintenance' in the two role CHECKs (members + invites).
--   2. Keep the crew out of member data: is_club_member() was true for ANY
--      membership, so a maintenance login would have read the roster, calendar
--      plans and lesson notes straight through RLS. It now excludes
--      'maintenance'. No-op for every existing user (no maintenance rows exist
--      when this runs). is_club_team() / is_club_staff() list their roles
--      explicitly and already exclude it.
--   3. An own-row read policy on cc_club_members, so the middleware, sidebar
--      and post-login redirect (which read the user's OWN role through the
--      user-scoped client) still work for a maintenance user.
--
-- MaintenanceMode's own tables are reached only through service-role API
-- routes, so the crew never needs is_club_member().
--
-- Run: node scripts/dbrun.mjs supabase/migrations/20260911_maintenance_role.sql
-- Safe to re-run.
-- =====================================================================

-- 1. Role CHECKs. The originals were declared inline, so find them by
--    definition rather than trusting a generated name.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.cc_club_members'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.cc_club_members DROP CONSTRAINT %I', c);
  END LOOP;

  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.cc_club_invites'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.cc_club_invites DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.cc_club_members ADD CONSTRAINT cc_club_members_role_check
  CHECK (role IN ('owner', 'director', 'coach', 'front_desk', 'maintenance', 'member'));

ALTER TABLE public.cc_club_invites ADD CONSTRAINT cc_club_invites_role_check
  CHECK (role IN ('director', 'coach', 'front_desk', 'maintenance', 'member'));

-- 3. Own-row read policy FIRST, so nobody loses sight of their own membership
--    in the instant between the two statements below.
DROP POLICY IF EXISTS "Read own memberships" ON public.cc_club_members;
CREATE POLICY "Read own memberships" ON public.cc_club_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 2. Any club role EXCEPT maintenance.
CREATE OR REPLACE FUNCTION public.is_club_member(target_club uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT target_club IS NOT NULL AND EXISTS (
    SELECT 1 FROM cc_club_members m
     WHERE m.club_id = target_club
       AND m.user_id = auth.uid()
       AND m.role <> 'maintenance'
  );
$$;

COMMENT ON FUNCTION public.is_club_member(uuid) IS
  'Any club role EXCEPT maintenance. The maintenance crew sees only MaintenanceMode, through service-role routes.';
