-- Who opened a demo link, per letter.
--
-- Cold letters carry ?r=<ref> on their demo link (crm_outreach_queue.ref), so
-- a visit tells us which club clicked and which letter (A/B) got the click.
-- No open/click tracking at the mail provider on purpose: rewritten links and
-- tracking pixels are what spam filters look for on a young domain.
--
-- is_sample marks the shared cold-email demo (Harbor View), whose tour must
-- not tell a stranger "this is a working copy of your club".
ALTER TABLE public.demo_links ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;
UPDATE public.demo_links SET is_sample = true WHERE token = '45onWN-EceJIkrIBmWtly4FZ6EVGEQ7H';

CREATE TABLE IF NOT EXISTS public.demo_visits (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token      text NOT NULL,
  ref        text,
  path       text,
  user_agent text,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS demo_visits_ref_idx ON public.demo_visits (ref) WHERE ref IS NOT NULL;
ALTER TABLE public.demo_visits ENABLE ROW LEVEL SECURITY;  -- service role only

ALTER TABLE public.crm_outreach_queue ADD COLUMN IF NOT EXISTS ref text UNIQUE;
