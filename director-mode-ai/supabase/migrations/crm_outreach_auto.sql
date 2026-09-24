-- Outreach autopilot (9/23/26): 6 cold letters a weekday, no swipe.
--
--   3 from the Directors Club list (lane 'dca') + 3 clubs found on the web
--   (lane 'found', crm_orgs.source = 'discovered'), split-tested A vs B:
--     A = the whole platform, links the shared sample club tour
--     B = one tool that sits alongside what they already use (MixerMode),
--         links the sample club's live mixer — the Hal Kushins lesson.
--
-- auto_send starts FALSE. Until Darrin flips it the planner still writes
-- `planned` cards for the deck; flipped, it writes them `approved` and the
-- hourly sender takes them from there.

ALTER TABLE public.crm_outreach_settings
  ADD COLUMN IF NOT EXISTS auto_send      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dca_per_day    integer NOT NULL DEFAULT 3 CHECK (dca_per_day BETWEEN 0 AND 50),
  ADD COLUMN IF NOT EXISTS found_per_day  integer NOT NULL DEFAULT 3 CHECK (found_per_day BETWEEN 0 AND 50),
  ADD COLUMN IF NOT EXISTS demo_url       text,
  ADD COLUMN IF NOT EXISTS mixer_url      text,
  ADD COLUMN IF NOT EXISTS digest_emails  text[] NOT NULL DEFAULT ARRAY['darrinjco@gmail.com','me@kgcarey.com'];

ALTER TABLE public.crm_outreach_queue
  ADD COLUMN IF NOT EXISTS variant text CHECK (variant IS NULL OR variant IN ('A','B')),
  ADD COLUMN IF NOT EXISTS lane    text CHECK (lane IS NULL OR lane IN ('dca','found'));

-- 6 a day total, no ramp: the cap is small enough to start at.
UPDATE public.crm_outreach_settings
   SET daily_cap = 6, warmup_steps = '[]'::jsonb
 WHERE id = 1;
