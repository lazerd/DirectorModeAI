-- 9/29/26: the twelve one-tool cold letters (T1..T12) join A/B/C in the
-- autopilot's split test, and any letter can be paused from /crm/autopilot.
ALTER TABLE public.crm_outreach_queue DROP CONSTRAINT IF EXISTS crm_outreach_queue_variant_check;
ALTER TABLE public.crm_outreach_queue ADD CONSTRAINT crm_outreach_queue_variant_check
  CHECK (variant IS NULL OR variant IN ('A','B','C','T1','T2','T3','T4','T5','T6','T7','T8','T9','T10','T11','T12'));

ALTER TABLE public.crm_outreach_settings ADD COLUMN IF NOT EXISTS paused_variants text[] NOT NULL DEFAULT '{}';
