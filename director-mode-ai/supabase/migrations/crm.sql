-- =====================================================================
-- The sales CRM — Darrin and Kevin's private deal tracker.
--
--   Who may look  crm_users  + is_crm_user()
--   Prospects     crm_orgs
--   People        crm_contacts
--   What happened crm_activities
--
-- THIS IS NOT CLUB DATA. Every other table in this database hangs off
-- cc_clubs and is readable by that club's staff. These four deliberately do
-- not: crm_orgs.club_id is a nullable pointer OUT to a club we happen to have
-- built a demo for, never a tenant key, and no club policy is consulted
-- anywhere below. A club owner reading their own rows must never be able to
-- reach the note about whether they are going to buy.
--
-- ACCESS: one predicate, is_crm_user(), used by every policy on every table.
-- It is SECURITY DEFINER because crm_users itself is behind RLS, so a policy
-- that queried it directly would recurse. Both identities are checked — the
-- auth.users id once they have signed in, and the email before they ever have
-- — so an allowlist row added for someone with no account yet starts working
-- the moment they log in, with nothing to re-run.
--
-- ANON GETS NOTHING. The policies are TO authenticated only, and the grants
-- below are revoked from anon explicitly rather than left to the absence of a
-- policy: two locks on the door that must never open.
--
-- Run: node scripts/dbrun.mjs supabase/migrations/crm.sql
-- Safe to re-run.
-- =====================================================================

-- ----------------------------------------------------------- the allowlist
--
-- Email is the durable key, not user_id: we invite a person before they have
-- an account. Lower-cased by a CHECK rather than citext, which this database
-- does not have installed, so "Kevin@..." and "kevin@..." can never become
-- two rows. scripts/crm-user.mjs is the only thing that should write here.
CREATE TABLE IF NOT EXISTS public.crm_users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL UNIQUE
               CHECK (email = lower(btrim(email)) AND position('@' in email) > 1),
  user_id    uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name  text,
  -- Two characters on a pipeline card. Derived from full_name when not given.
  initials   text,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_users_active_idx ON public.crm_users (active);

-- ------------------------------------------------------------- the predicate
--
-- SECURITY DEFINER so it can read crm_users through that table's own RLS, and
-- STABLE so the planner calls it once per statement rather than per row.
-- search_path is pinned: a SECURITY DEFINER function without it can be
-- hijacked by a caller who puts their own crm_users earlier on the path.
CREATE OR REPLACE FUNCTION public.is_crm_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.crm_users u
    WHERE u.active
      AND (
        (auth.uid()   IS NOT NULL AND u.user_id = auth.uid())
        OR
        (auth.email() IS NOT NULL AND u.email   = lower(btrim(auth.email())))
      )
  );
$$;
REVOKE ALL ON FUNCTION public.is_crm_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_crm_user() TO authenticated, service_role;

-- ------------------------------------------------------------------- orgs
--
-- One row per club we are trying to sell. `stage` is the pipeline column; the
-- order lives in src/lib/crm/stages.ts and the CHECK here is the same list, so
-- a typo in a PATCH is a 500 rather than a card that vanishes off the board.
CREATE TABLE IF NOT EXISTS public.crm_orgs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL CHECK (length(btrim(name)) > 0),
  slug             text NOT NULL UNIQUE CHECK (slug = lower(slug)),
  -- Set once we have built them a ClubMode club to demo. NOT a tenant key:
  -- nothing in this schema is scoped by it, and ON DELETE SET NULL means
  -- tearing a demo down leaves the deal intact.
  club_id          uuid REFERENCES public.cc_clubs(id) ON DELETE SET NULL,
  website          text,
  city             text,
  state            text,
  type             text NOT NULL DEFAULT 'club'
                     CHECK (type IN ('club','community','facility')),
  member_count     int CHECK (member_count IS NULL OR member_count >= 0),
  stage            text NOT NULL DEFAULT 'researching'
                     CHECK (stage IN ('researching','contacted','meeting_set','demo_done',
                                      'pilot','proposal','won','lost')),
  -- Which of the two reps owns it. Free text, not an FK to crm_users: a deal
  -- must not become unassignable because someone was deactivated.
  owner_email      text,
  -- $75/mo is the list price; per-deal so a bigger club can carry a bigger
  -- number without the pipeline total lying.
  mrr_target_cents int NOT NULL DEFAULT 7500 CHECK (mrr_target_cents >= 0),
  source           text,
  next_step        text,
  next_step_at     date,
  demo_url         text,
  notes            text,
  won_at           timestamptz,
  lost_at          timestamptz,
  lost_reason      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_orgs_stage_idx     ON public.crm_orgs (stage, next_step_at);
CREATE INDEX IF NOT EXISTS crm_orgs_next_step_idx ON public.crm_orgs (next_step_at) WHERE next_step_at IS NOT NULL;

-- --------------------------------------------------------------- contacts
--
-- `role` is free text on purpose: "decision maker", "champion", "gatekeeper"
-- and "the one who actually answers" are all things the reps write, and an
-- enum would make them pick the wrong one.
CREATE TABLE IF NOT EXISTS public.crm_contacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.crm_orgs(id) ON DELETE CASCADE,
  full_name      text NOT NULL CHECK (length(btrim(full_name)) > 0),
  title          text,
  email          text,
  phone          text,
  role           text,
  is_primary     boolean NOT NULL DEFAULT false,
  do_not_contact boolean NOT NULL DEFAULT false,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_contacts_org_idx ON public.crm_contacts (org_id, is_primary DESC, full_name);
-- Board pages list the same person twice often enough to matter, and the seed
-- is re-run. Name is the natural key within an org; a partial unique index
-- keeps two blank-email volunteers from both being "Chris Slee".
CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_org_name_key
  ON public.crm_contacts (org_id, lower(btrim(full_name)));

-- ------------------------------------------------------------- activities
--
-- Append-only in practice. `created_by_email` rather than a user_id because
-- this is also written by scripts (the seed, and one day an inbound webhook)
-- where there is no signed-in user to point at.
CREATE TABLE IF NOT EXISTS public.crm_activities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.crm_orgs(id) ON DELETE CASCADE,
  contact_id       uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  kind             text NOT NULL DEFAULT 'note'
                     CHECK (kind IN ('note','call','email','meeting','demo','proposal','stage_change')),
  body             text NOT NULL CHECK (length(btrim(body)) > 0),
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  created_by_email text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_activities_org_idx ON public.crm_activities (org_id, occurred_at DESC);

-- --------------------------------------------------------------- updated_at
CREATE OR REPLACE FUNCTION public.touch_crm_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_orgs_touch     ON public.crm_orgs;
CREATE TRIGGER crm_orgs_touch     BEFORE UPDATE ON public.crm_orgs
  FOR EACH ROW EXECUTE FUNCTION public.touch_crm_updated_at();
DROP TRIGGER IF EXISTS crm_contacts_touch ON public.crm_contacts;
CREATE TRIGGER crm_contacts_touch BEFORE UPDATE ON public.crm_contacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_crm_updated_at();

-- -------------------------------------------------------------------- RLS
--
-- One predicate, four tables, both directions. USING governs what is visible,
-- WITH CHECK what may be written — both is_crm_user(), because a rep who can
-- see the pipeline can edit it and nobody else may do either.
ALTER TABLE public.crm_users      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_orgs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_contacts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_orgs','crm_contacts','crm_activities'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_crm_read',  t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_crm_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_crm_user())',
      t || '_crm_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.is_crm_user()) WITH CHECK (public.is_crm_user())',
      t || '_crm_write', t);
  END LOOP;
END $$;

-- The allowlist is readable by the reps (so the app can show whose deal is
-- whose) but never writable from a session. Adding Kevin is a service-role
-- script, not something a stolen cookie can do.
DROP POLICY IF EXISTS crm_users_crm_read ON public.crm_users;
CREATE POLICY crm_users_crm_read ON public.crm_users
  FOR SELECT TO authenticated USING (public.is_crm_user());

-- ----------------------------------------------------------------- grants
-- Belt and braces: even with a policy bug, anon holds no privilege here.
REVOKE ALL ON public.crm_users, public.crm_orgs, public.crm_contacts, public.crm_activities FROM anon;
GRANT SELECT ON public.crm_users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.crm_orgs, public.crm_contacts, public.crm_activities TO authenticated;
