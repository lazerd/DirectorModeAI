-- =====================================================================
-- Cold outreach — the swipe deck's tables.
--
-- Additive to crm.sql and crm_email.sql. Same is_crm_user() predicate, same
-- anon revoke, same "safe to re-run" rule.
--
-- WHY A QUEUE AND NOT JUST A SEND: the whole point of the deck is that a
-- human looked at the actual email and swiped right. So the email exists,
-- fully written, BEFORE anyone has decided anything — a planned row is a
-- draft with a date on it. Only `approved` is sendable; every other status is
-- a thing that happened to a draft. The sender's WHERE clause is the last
-- lock: `status = 'approved'`, and there is no other path to Resend.
--
--   crm_outreach_queue        one row per planned email
--   crm_outreach_suppression  clubs and addresses we will never propose again
--   crm_outreach_settings     one row; cap, window, pause switch, warmup
--
-- Run: node scripts/dbrun.mjs supabase/migrations/crm_outreach.sql
-- Safe to re-run.
-- =====================================================================

-- ------------------------------------------------- two columns on crm_orgs
--
-- Both are also being added by the /crm rewrite happening in parallel. IF NOT
-- EXISTS on each, same names and same types, so whichever migration lands
-- first wins and the second is a no-op — the two branches converge rather
-- than fight.
--
--   region    normalised out of the DCA import's notes ("DCA East region.").
--             The planner orders by it, and reading it out of free text on
--             every plan is both slow and one typo away from wrong.
--   queued_at when a rep explicitly picked this club off the cold list. A
--             timestamp rather than a boolean so "the ones Kevin starred this
--             morning" keep their order.
ALTER TABLE public.crm_orgs ADD COLUMN IF NOT EXISTS region    text;
ALTER TABLE public.crm_orgs ADD COLUMN IF NOT EXISTS queued_at timestamptz;
CREATE INDEX IF NOT EXISTS crm_orgs_queued_idx ON public.crm_orgs (queued_at) WHERE queued_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_orgs_region_idx ON public.crm_orgs (region);

-- Backfill region from the note the importer wrote. Only where it is still
-- null, so a rep who corrected one by hand is never overwritten.
UPDATE public.crm_orgs SET region = 'West'          WHERE region IS NULL AND notes ILIKE '%DCA West region%';
UPDATE public.crm_orgs SET region = 'Central'       WHERE region IS NULL AND notes ILIKE '%DCA Central region%';
UPDATE public.crm_orgs SET region = 'East'          WHERE region IS NULL AND notes ILIKE '%DCA East region%';
UPDATE public.crm_orgs SET region = 'International' WHERE region IS NULL AND notes ILIKE '%DCA International region%';

-- --------------------------------------------------------------- settings
--
-- One row, id = 1, enforced by a CHECK rather than by convention: a second
-- settings row is a silent disaster (half the sends honour the pause switch).
--
-- The warmup ramp is DATA, not a constant in plan.ts. outreach.clubmode.ai is
-- a brand-new sending domain; going straight to 15/day from a cold IP is how
-- a domain lands in spam before anyone replies. `warmup_steps` is read in
-- order — 3 days at 5, then 3 days at 10, then daily_cap forever — and Darrin
-- can flatten or extend it from a SQL prompt without a deploy.
CREATE TABLE IF NOT EXISTS public.crm_outreach_settings (
  id                serial PRIMARY KEY CHECK (id = 1),
  daily_cap         int  NOT NULL DEFAULT 15 CHECK (daily_cap BETWEEN 0 AND 200),
  -- Club-local, not UTC and not Pacific: an 8 AM email to a club in Boston
  -- should land at 8 AM in Boston. See zoneForRegion() in lib/outreach/window.ts.
  send_window_start time NOT NULL DEFAULT '08:00',
  send_window_end   time NOT NULL DEFAULT '15:00',
  -- The global stop. Honoured by the planner, the deck, and the sender.
  paused            boolean NOT NULL DEFAULT false,
  warmup_start_date date,
  warmup_steps      jsonb NOT NULL DEFAULT '[{"days":3,"cap":5},{"days":3,"cap":10}]'::jsonb,
  follow_up_days    int  NOT NULL DEFAULT 8 CHECK (follow_up_days BETWEEN 1 AND 90),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.crm_outreach_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS crm_outreach_settings_touch ON public.crm_outreach_settings;
CREATE TRIGGER crm_outreach_settings_touch BEFORE UPDATE ON public.crm_outreach_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_crm_updated_at();

-- ------------------------------------------------------------ suppression
--
-- A left swipe, a bounce, a "no thanks" — all end up here, and the planner
-- joins against it before it proposes anything. Either column may be null:
-- suppressing an ADDRESS (bounced) must not blind us to the rest of the
-- board, and suppressing a CLUB must cover contacts we have not met yet.
--
-- queue_id is what Undo uses: it deletes the suppression this exact decision
-- created, rather than every suppression that club has ever collected.
CREATE TABLE IF NOT EXISTS public.crm_outreach_suppression (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text CHECK (email IS NULL OR email = lower(btrim(email))),
  org_id     uuid REFERENCES public.crm_orgs(id) ON DELETE CASCADE,
  reason     text NOT NULL DEFAULT 'manual'
               CHECK (reason IN ('bounced','complaint','no thanks','swiped left','manual')),
  note       text,
  queue_id   uuid,
  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A row that suppresses nothing is a bug, not a row.
  CHECK (email IS NOT NULL OR org_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS crm_outreach_supp_email_idx ON public.crm_outreach_suppression (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_outreach_supp_org_idx   ON public.crm_outreach_suppression (org_id) WHERE org_id IS NOT NULL;

-- ----------------------------------------------------------------- queue
--
-- `status` is the whole state machine, and it is deliberately one-way from
-- the sender's point of view:
--
--   planned   written, not decided. NOT sendable.
--   approved  a rep swiped right. The ONLY sendable status.
--   sent      Resend accepted it; resend_id has the message.
--   rejected  swiped left. The club is suppressed at the same moment.
--   snoozed   back in the deck in 7 days (send_date carries the date).
--   failed    the send was attempted and did not happen. Not retried
--             automatically — a failure nobody looked at should not turn
--             into a loop against a cold domain.
--
-- dedupe_key is the re-run guard: '<org_id>:intro' and '<org_id>:followup'.
-- Unique, so planning twice in a morning cannot queue the same club twice,
-- and no club can ever collect a third email from this system.
CREATE TABLE IF NOT EXISTS public.crm_outreach_queue (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.crm_orgs(id) ON DELETE CASCADE,
  contact_id    uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  rep_email     text NOT NULL,
  send_date     date NOT NULL,
  subject       text NOT NULL,
  body          text NOT NULL,
  -- One line on the card: why this club, why now. Shown above the email.
  why           text,
  status        text NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned','approved','sent','rejected','snoozed','failed')),
  -- 'intro' or 'followup'. The planner refuses to write a followup to a
  -- followup, and there is no third kind.
  kind          text NOT NULL DEFAULT 'intro' CHECK (kind IN ('intro','followup')),
  follow_up_of  uuid REFERENCES public.crm_outreach_queue(id) ON DELETE SET NULL,
  -- Whether Claude wrote this one or the plain template did. A card that fell
  -- back is not worse, but it is worth being able to count them.
  generated_by  text NOT NULL DEFAULT 'template' CHECK (generated_by IN ('model','template')),
  approved_at   timestamptz,
  sent_at       timestamptz,
  resend_id     text,
  reject_reason text,
  detail        text,
  dedupe_key    text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- The deck's query: today's planned rows for one rep.
CREATE INDEX IF NOT EXISTS crm_outreach_queue_deck_idx ON public.crm_outreach_queue (status, send_date, rep_email);
CREATE INDEX IF NOT EXISTS crm_outreach_queue_org_idx  ON public.crm_outreach_queue (org_id, created_at DESC);

DROP TRIGGER IF EXISTS crm_outreach_queue_touch ON public.crm_outreach_queue;
CREATE TRIGGER crm_outreach_queue_touch BEFORE UPDATE ON public.crm_outreach_queue
  FOR EACH ROW EXECUTE FUNCTION public.touch_crm_updated_at();

-- -------------------------------------------------------------------- RLS
ALTER TABLE public.crm_outreach_queue       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_outreach_suppression ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_outreach_settings    ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_outreach_queue','crm_outreach_suppression','crm_outreach_settings'] LOOP
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

REVOKE ALL ON public.crm_outreach_queue, public.crm_outreach_suppression, public.crm_outreach_settings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.crm_outreach_queue, public.crm_outreach_suppression, public.crm_outreach_settings TO authenticated;

-- ------------------------------------------------------- outreach templates
--
-- The letter lives here, not in a .tsx, for the same reason the CRM's
-- templates do: the wording is the product, and tuning it must not need a
-- deploy. `outreach-intro` is BOTH the fallback the validator falls back to
-- AND the shape the model is told to write — one source of truth, so the
-- generated card and the plain card read like the same person.
INSERT INTO public.crm_templates (slug, name, subject, body, sort_order) VALUES
  ('outreach-intro', 'Cold intro (outreach deck)',
   'A question about {{club}}',
   E'Hi {{first_name}},\n\n'
   'I run the tennis program at a club in California. We were paying for software that did about a third of what we needed, so I built our own — and it turned into a real product.\n\n'
   'It is the club''s own website, court booking, members finding each other a fourth, captain tools for league teams, and a QR code at the gate for court check-in. Two clubs at Rossmoor and Lafayette Tennis Club are on it now. I built each of them a working site before anyone paid me anything.\n\n'
   'I would rather show you {{club}}''s than describe mine. Worth 15 minutes?', 100),
  ('outreach-followup', 'One follow-up (outreach deck)',
   'Re: A question about {{club}}',
   E'Hi {{first_name}},\n\n'
   'Following up once on the note below, then I will leave you alone.\n\n'
   'The offer stands: I will build {{club}} a working site — your courts, your programs, your schedule — and send you the link. No cost and no commitment; if it is not useful you just close the tab.\n\n'
   'Worth 15 minutes?', 101)
ON CONFLICT (slug) DO NOTHING;
