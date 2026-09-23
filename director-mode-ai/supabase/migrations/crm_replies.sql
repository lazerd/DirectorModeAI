-- CRM replies: what comes BACK from a prospect, on the timeline.
--
-- Until now the CRM only knew what it sent. Every letter carries
-- Reply-To: hello@clubmode.ai, Namecheap forwards that to Darrin's Gmail, and
-- the pipeline never heard about it (Hal Kushins, Rossmoor Pickleball, 9/22/26).
--
-- The path now: Namecheap ALSO forwards hello@ to Resend's inbound address,
-- Resend fires `email.received` at /api/captain/inbound, and anything that is
-- not a captain team address is tried here — matched to a crm_contacts row by
-- the sender's address. Matched mail becomes a `reply` activity; unmatched mail
-- is kept (org_id null) so nothing is silently dropped.

-- ------------------------------------------------------------ reply kind
ALTER TABLE public.crm_activities DROP CONSTRAINT IF EXISTS crm_activities_kind_check;
ALTER TABLE public.crm_activities ADD CONSTRAINT crm_activities_kind_check
  CHECK (kind IN ('note','call','email','reply','meeting','demo','proposal','stage_change'));

-- A reply stops the automatic follow-up, the same way a left swipe does.
ALTER TABLE public.crm_outreach_suppression DROP CONSTRAINT IF EXISTS crm_outreach_suppression_reason_check;
ALTER TABLE public.crm_outreach_suppression ADD CONSTRAINT crm_outreach_suppression_reason_check
  CHECK (reason IN ('bounced','complaint','no thanks','swiped left','manual','replied'));

-- ------------------------------------------------------------- the mail
CREATE TABLE IF NOT EXISTS public.crm_inbound_emails (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Resend's id. Unique so a retried webhook cannot file the same email twice.
  resend_email_id  text UNIQUE,
  org_id           uuid REFERENCES public.crm_orgs(id) ON DELETE CASCADE,
  contact_id       uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  activity_id      uuid REFERENCES public.crm_activities(id) ON DELETE SET NULL,
  from_email       text NOT NULL,
  from_name        text,
  subject          text,
  -- What they wrote, quoted history cut off. full_body keeps everything.
  body             text NOT NULL,
  full_body        text,
  -- The RFC 5322 Message-ID, so our answer threads under theirs.
  message_id       text,
  received_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS crm_inbound_org_idx ON public.crm_inbound_emails (org_id, received_at DESC);

ALTER TABLE public.crm_inbound_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_inbound_crm_read ON public.crm_inbound_emails;
CREATE POLICY crm_inbound_crm_read ON public.crm_inbound_emails
  FOR SELECT TO authenticated USING (public.is_crm_user());

-- Which activity a reply answers, so the History row can offer "Reply".
ALTER TABLE public.crm_activities ADD COLUMN IF NOT EXISTS inbound_id uuid
  REFERENCES public.crm_inbound_emails(id) ON DELETE SET NULL;
