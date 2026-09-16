-- =====================================================================
-- CRM compose + send — templates and the send ledger.
--
-- Additive to crm.sql; same is_crm_user() predicate, same anon revoke.
--
-- WHY A LEDGER AND NOT JUST AN ACTIVITY ROW: crm_activities is the reps'
-- narrative — what happened with this club, readable newest-first. It is the
-- wrong place to hang a rate limiter off, because a rep is free to edit or
-- delete a note, and an hourly cap you can delete your way out of is not a
-- cap. crm_email_sends is the machine's copy: every attempt, sent or held or
-- failed, never edited. The activity row is written FROM it.
--
-- Run: node scripts/dbrun.mjs supabase/migrations/crm_email.sql
-- Safe to re-run.
-- =====================================================================

-- -------------------------------------------------------------- templates
--
-- Editable rows, not constants in a .tsx: the wording of a cold intro is the
-- part of this that actually gets tuned, and it should not need a deploy.
-- `slug` is stable so the seed can upsert without making duplicates.
CREATE TABLE IF NOT EXISTS public.crm_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text NOT NULL UNIQUE CHECK (slug = lower(slug)),
  name       text NOT NULL,
  subject    text NOT NULL,
  body       text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  archived   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_templates_order_idx ON public.crm_templates (archived, sort_order);

DROP TRIGGER IF EXISTS crm_templates_touch ON public.crm_templates;
CREATE TRIGGER crm_templates_touch BEFORE UPDATE ON public.crm_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_crm_updated_at();

-- ------------------------------------------------------------ send ledger
--
-- One row per ATTEMPT. `status` distinguishes the four endings that matter:
--
--   sent     Resend accepted it
--   held     the demo guard swallowed it (see src/lib/crm/send.ts — this is
--            the case that must never look like a success)
--   blocked  we refused before Resend: do-not-contact, unsubscribed, no
--            postal address configured, over the rate limit
--   failed   Resend rejected it, `detail` has the message
--
-- The body is stored so both reps can read what was actually sent, months
-- later, without digging in Resend.
CREATE TABLE IF NOT EXISTS public.crm_email_sends (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.crm_orgs(id) ON DELETE CASCADE,
  contact_id    uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  to_email      text NOT NULL,
  from_email    text NOT NULL,
  reply_to      text NOT NULL,
  subject       text NOT NULL,
  body          text NOT NULL,
  template_slug text,
  status        text NOT NULL CHECK (status IN ('sent','held','blocked','failed')),
  detail        text,
  message_id    text,
  sent_by_email text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- The rate limiter's index: "how many has this rep sent since X".
CREATE INDEX IF NOT EXISTS crm_email_sends_rep_idx ON public.crm_email_sends (sent_by_email, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_email_sends_org_idx ON public.crm_email_sends (org_id, created_at DESC);

-- -------------------------------------------------------------------- RLS
ALTER TABLE public.crm_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_email_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_templates_crm_read    ON public.crm_templates;
DROP POLICY IF EXISTS crm_templates_crm_write   ON public.crm_templates;
CREATE POLICY crm_templates_crm_read  ON public.crm_templates
  FOR SELECT TO authenticated USING (public.is_crm_user());
CREATE POLICY crm_templates_crm_write ON public.crm_templates
  FOR ALL TO authenticated USING (public.is_crm_user()) WITH CHECK (public.is_crm_user());

-- The ledger is readable by the reps and written only by the send route
-- (service role). A session that could insert here could forge a send record.
DROP POLICY IF EXISTS crm_email_sends_crm_read ON public.crm_email_sends;
CREATE POLICY crm_email_sends_crm_read ON public.crm_email_sends
  FOR SELECT TO authenticated USING (public.is_crm_user());

REVOKE ALL ON public.crm_templates, public.crm_email_sends FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_templates TO authenticated;
GRANT SELECT ON public.crm_email_sends TO authenticated;
