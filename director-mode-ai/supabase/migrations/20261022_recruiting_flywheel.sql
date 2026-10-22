-- ClubMode Recruiting flywheel.
-- 1. Scout: scrape public tennis job boards daily → connect_sourced_jobs (facts + our
--    own summary + link to the original; never the poster's full text).
-- 2. Evaluate: AI turns each job into an ideal-candidate profile (target comp band,
--    radius, scope, must-haves), estimating pay from the club's 990 when unposted.
-- 3. Recruit: rank prospects (opted-in candidates + 990 directors) against that profile
--    → connect_prospect_targets; draft outreach → connect_outreach (human approves
--    anything to a person or club that hasn't opted in).
-- 4. Close: when a sourced job has interested, qualified candidates, pitch the club
--    the $4,950 pay-on-hire terms; on acceptance it becomes a connect_openings row.

create table if not exists public.connect_sourced_jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null,                     -- e.g. 'rspa', 'ptr', 'cmaa'
  source_url text not null,                 -- the original posting
  external_id text,
  fingerprint text not null unique,         -- dedupe across sources: club|title|state normalized
  club_name text,
  title text,
  dept text default 'Tennis/Racquets',
  role_level text,                          -- 'director' | 'head_pro' | 'assistant' | 'gm' | 'other'
  city text,
  state text,
  zip text,
  lat double precision,
  lng double precision,
  comp_min integer,
  comp_max integer,
  comp_text text,                           -- as posted, e.g. "$85k + lessons"
  summary text,                             -- our own AI-written summary
  requirements text,
  apply_url text,
  apply_email text,
  contact_name text,
  posted_at date,
  deadline date,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'active',    -- active | expired | claimed | hidden
  club_ein text,                            -- matched 990 filer
  club_revenue bigint,
  est_comp integer,                         -- estimated total comp when not posted (990 peers)
  evaluation jsonb,                         -- ideal-candidate profile from the evaluator
  evaluated_at timestamptz,
  opening_id uuid references public.connect_openings(id) on delete set null, -- once the club accepts terms
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_sourced_jobs_status on public.connect_sourced_jobs(status);
alter table public.connect_sourced_jobs enable row level security;
drop policy if exists sourced_jobs_public_read on public.connect_sourced_jobs;
create policy sourced_jobs_public_read on public.connect_sourced_jobs
  for select using (status = 'active');

-- Prospects ranked for a job (sourced or retained).
create table if not exists public.connect_prospect_targets (
  id uuid primary key default gen_random_uuid(),
  sourced_job_id uuid references public.connect_sourced_jobs(id) on delete cascade,
  opening_id uuid references public.connect_openings(id) on delete cascade,
  candidate_id uuid references public.connect_candidates(id) on delete cascade, -- opted-in person
  prospect_ein text,                        -- 990 person (not opted in)
  prospect_name text,
  prospect_club text,
  prospect_comp integer,
  prospect_city text,
  prospect_state text,
  distance_miles double precision,
  fit_score integer,                        -- 0-100
  fit_reason text,                          -- one-line why
  tier text,                                -- 'step_up' | 'lateral' | 'stretch'
  status text not null default 'new',       -- new | queued | contacted | interested | applied | not_interested | skipped
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_prospect_target_job_cand on public.connect_prospect_targets(sourced_job_id, candidate_id) where candidate_id is not null;
create unique index if not exists uq_prospect_target_job_990 on public.connect_prospect_targets(sourced_job_id, prospect_ein, prospect_name) where prospect_ein is not null;
alter table public.connect_prospect_targets enable row level security; -- service role only

-- Every outbound message the flywheel proposes or sends.
create table if not exists public.connect_outreach (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                       -- 'candidate_invite' | 'prospect_recruit' | 'club_pitch'
  sourced_job_id uuid references public.connect_sourced_jobs(id) on delete cascade,
  opening_id uuid references public.connect_openings(id) on delete cascade,
  target_id uuid references public.connect_prospect_targets(id) on delete cascade,
  to_name text,
  to_email text,
  subject text,
  body_html text,
  status text not null default 'draft',     -- draft | approved | sent | skipped | failed | needs_email
  auto boolean not null default false,      -- true = allowed to send without approval (opted-in candidates only)
  approved_by uuid,
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_connect_outreach_status on public.connect_outreach(status);
alter table public.connect_outreach enable row level security; -- service role only

-- Candidates who raised a hand on a sourced job (before the club has signed terms).
create table if not exists public.connect_job_interests (
  id uuid primary key default gen_random_uuid(),
  sourced_job_id uuid not null references public.connect_sourced_jobs(id) on delete cascade,
  candidate_id uuid not null references public.connect_candidates(id) on delete cascade,
  consent_at timestamptz not null default now(), -- OK to present me to this club
  note text,
  status text not null default 'interested',  -- interested | presented | withdrawn
  created_at timestamptz not null default now(),
  unique (sourced_job_id, candidate_id)
);
alter table public.connect_job_interests enable row level security;
drop policy if exists job_interests_own on public.connect_job_interests;
create policy job_interests_own on public.connect_job_interests
  for select using (candidate_id in (select id from public.connect_candidates where profile_id = auth.uid()));

-- Decision-makers found on club websites (GM, board/tennis committee, HR) for club pitches.
create table if not exists public.connect_club_contacts (
  id uuid primary key default gen_random_uuid(),
  sourced_job_id uuid references public.connect_sourced_jobs(id) on delete cascade,
  club_name text not null,
  club_website text,
  name text,
  role text,                                -- 'gm' | 'board' | 'tennis_committee' | 'hr' | 'hiring_contact'
  title text,
  email text,
  phone text,
  source_url text,                          -- page the contact was found on
  confidence text default 'found',          -- found | inferred
  last_contacted_at timestamptz,
  touches integer not null default 0,
  do_not_contact boolean not null default false,
  created_at timestamptz not null default now(),
  unique (club_name, email)
);
alter table public.connect_club_contacts enable row level security; -- service role only
alter table public.connect_outreach add column if not exists contact_id uuid references public.connect_club_contacts(id) on delete set null;
alter table public.connect_outreach add column if not exists touch_number integer not null default 1;
