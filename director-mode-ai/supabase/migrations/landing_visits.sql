-- Campaign landing pages (/mixermode, /pulse) and how far a visitor got.
-- ref = the outreach letter's ?r= code (crm_outreach_queue.ref), so the A/B
-- scoreboard can count opens and deeper steps per letter. Written only by
-- /api/landing/visit with the service key; no client policies on purpose.
create table if not exists public.landing_visits (
  id uuid primary key default gen_random_uuid(),
  ref text,
  page text not null,
  event text not null,
  user_agent text,
  at timestamptz not null default now()
);
create index if not exists landing_visits_ref_idx on public.landing_visits (ref) where ref is not null;
alter table public.landing_visits enable row level security;

-- New letters M (MixerMode) and P (Director Pulse) ship paused: autopilot is
-- live and new letters catch up to the others' counts first.
update public.crm_outreach_settings
   set paused_variants = (select array(select distinct unnest(coalesce(paused_variants, '{}') || array['M','P'])));
