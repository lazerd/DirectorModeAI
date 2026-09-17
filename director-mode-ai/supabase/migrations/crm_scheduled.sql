-- =====================================================================
-- CRM scheduled sends — "send this on Thursday at 8".
--
-- Additive to crm.sql and crm_email.sql. Same is_crm_user() predicate, same
-- anon revoke, same "safe to re-run" rule.
--
-- WHY THE WHOLE MESSAGE IS ON THE ROW: `subject` and `body` here are the
-- RENDERED text — merge fields already filled in, exactly as the rep read
-- them in the preview before clicking Schedule. The sender does NOT go back
-- to crm_templates, and does not re-run the merge. That is the entire point
-- of scheduling: what you approved on Tuesday is what leaves on Thursday,
-- even if somebody edits the template, renames the club, or changes the
-- contact's name in between.
--
-- (The signature block — rep name, reply address, opt-out line and the
-- CAN-SPAM postal address — is still appended at send time by
-- lib/crm/compose.ts, because the scheduled send goes through exactly the
-- same sendCrmEmail() as an immediate one. Storing it would mean a second
-- copy of that rule to keep in step, and the postal address is env, not data.)
--
-- THE STATE MACHINE, and why 'sending' exists:
--
--   scheduled  waiting. The ONLY status the cron will pick up.
--   sending    a tick has CLAIMED this row. The claim is an UPDATE ... WHERE
--              status = 'scheduled', so two overlapping ticks cannot both
--              take it and a row cancelled a millisecond earlier is simply
--              not there to claim. A cancelled row can never send.
--   sent       it went. message_id has Resend's id.
--   cancelled  a rep cancelled it, or replaced it by rescheduling.
--   failed     it was attempted and did not send — detail says why, in the
--              words the composer would have used. Never retried
--              automatically: a failure nobody has read should not become a
--              loop against a domain we need for club mail.
--
-- Run: node scripts/dbrun.mjs supabase/migrations/crm_scheduled.sql
-- Safe to re-run.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.crm_scheduled_emails (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.crm_orgs(id)     ON DELETE CASCADE,
  -- A scheduled email with no recipient is not a draft, it is a hazard. If
  -- the contact is deleted the row goes with them.
  contact_id    uuid NOT NULL REFERENCES public.crm_contacts(id) ON DELETE CASCADE,
  -- Kept alongside contact_id so the list still reads correctly, and so the
  -- sender can prove it is writing to the address that was approved.
  to_email      text NOT NULL,
  subject       text NOT NULL,
  body          text NOT NULL,
  template_slug text,
  send_at       timestamptz NOT NULL,
  -- Whose send this is: the rate limit, the Reply-To and the ledger all key
  -- off the rep, and the cron re-checks they are still allowed before firing.
  rep_email     text NOT NULL,
  rep_name      text NOT NULL,
  status        text NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled','sending','sent','cancelled','failed')),
  detail        text,
  message_id    text,
  attempts      int NOT NULL DEFAULT 0,
  claimed_at    timestamptz,
  sent_at       timestamptz,
  cancelled_at  timestamptz,
  cancelled_by_email text,
  created_by_email   text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- The cron's only query: due, still waiting.
CREATE INDEX IF NOT EXISTS crm_scheduled_due_idx
  ON public.crm_scheduled_emails (send_at) WHERE status = 'scheduled';
-- The org page's list, and Today's count.
CREATE INDEX IF NOT EXISTS crm_scheduled_org_idx
  ON public.crm_scheduled_emails (org_id, send_at);

-- Re-runnable column adds, for a database that already has an older shape.
ALTER TABLE public.crm_scheduled_emails ADD COLUMN IF NOT EXISTS claimed_at         timestamptz;
ALTER TABLE public.crm_scheduled_emails ADD COLUMN IF NOT EXISTS cancelled_at       timestamptz;
ALTER TABLE public.crm_scheduled_emails ADD COLUMN IF NOT EXISTS cancelled_by_email text;
ALTER TABLE public.crm_scheduled_emails ADD COLUMN IF NOT EXISTS message_id         text;

DROP TRIGGER IF EXISTS crm_scheduled_touch ON public.crm_scheduled_emails;
CREATE TRIGGER crm_scheduled_touch BEFORE UPDATE ON public.crm_scheduled_emails
  FOR EACH ROW EXECUTE FUNCTION public.touch_crm_updated_at();

-- -------------------------------------------------------------------- RLS
--
-- Readable and writable by the two reps and nobody else — same rule as every
-- other crm_* table. The rows are shared, not per-rep: Darrin must be able to
-- see and cancel something Kevin queued, because they are partners and a
-- scheduled email nobody but its author can stop is a trap.
ALTER TABLE public.crm_scheduled_emails ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_scheduled_crm_read  ON public.crm_scheduled_emails;
DROP POLICY IF EXISTS crm_scheduled_crm_write ON public.crm_scheduled_emails;
CREATE POLICY crm_scheduled_crm_read  ON public.crm_scheduled_emails
  FOR SELECT TO authenticated USING (public.is_crm_user());
CREATE POLICY crm_scheduled_crm_write ON public.crm_scheduled_emails
  FOR ALL TO authenticated USING (public.is_crm_user()) WITH CHECK (public.is_crm_user());

REVOKE ALL ON public.crm_scheduled_emails FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_scheduled_emails TO authenticated;

-- ------------------------------------------------------------- the 15-min tick
--
-- NOT IN THIS FILE, and not in vercel.json. Two reasons:
--
--   1. vercel.json cannot hold it. This is a Hobby account, where a cron
--      entry more frequent than once a day fails the whole DEPLOY — not just
--      the cron. Every push after the outreach deck landed was rejected until
--      its hourly entry was removed. Sub-daily ticks live in pg_cron.
--   2. It carries CRON_SECRET, which does not belong in the repo.
--
-- So it is installed by hand, once, against the production database, with the
-- real secret substituted. Re-running is safe — unschedule first.
--
--   select cron.unschedule('crm-scheduled-send')
--     where exists (select 1 from cron.job where jobname = 'crm-scheduled-send');
--
--   select cron.schedule('crm-scheduled-send', '*/15 * * * *', $job$
--     select net.http_get(
--       url     := 'https://clubmode.ai/api/cron/crm-scheduled-send',
--       headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'))
--   $job$);
--
-- Sibling job, same shape, for reference: `outreach-send-hourly`.
